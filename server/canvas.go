package server

import (
	"encoding/json"
	"log"
	"os"
	"time"
)

func (s *Server) updateCanvas(pixels []Pixel) {
	s.canvasMu.Lock()
	defer s.canvasMu.Unlock()

	for _, p := range pixels {
		s.canvasData[Point{X: p.X, Y: p.Y}] = p.Color
	}

	s.isDirty = true
}

func (s *Server) clearCanvas() {
	s.canvasMu.Lock()
	defer s.canvasMu.Unlock()

	s.canvasData = make(map[Point]string)
	s.isDirty = true
}

func (s *Server) getCanvasPixels() []Pixel {
	s.canvasMu.RLock()
	defer s.canvasMu.RUnlock()

	pixels := make([]Pixel, 0, len(s.canvasData))
	for pt, color := range s.canvasData {
		pixels = append(pixels, Pixel{X: pt.X, Y: pt.Y, Color: color})
	}

	return pixels
}

func (s *Server) AutosaveWorker() {
	ticker := time.NewTicker(2 * time.Second)
	defer ticker.Stop()

	for range ticker.C {
		s.canvasMu.Lock()
		if !s.isDirty {
			s.canvasMu.Unlock()
			continue
		}

		s.isDirty = false
		pixels := make([]Pixel, 0, len(s.canvasData))
		for pt, color := range s.canvasData {
			pixels = append(pixels, Pixel{X: pt.X, Y: pt.Y, Color: color})
		}
		s.canvasMu.Unlock()

		s.writeToFile(pixels)
	}
}

func (s *Server) writeToFile(pixels []Pixel) {
	f, err := os.Create(CanvasFile)
	if err != nil {
		log.Printf("Error creating canvas file: %v", err)
		return
	}

	defer f.Close()
	json.NewEncoder(f).Encode(pixels)
}

func (s *Server) LoadCanvasFromFile() {
	f, err := os.Open(CanvasFile)
	if err != nil {
		return
	}
	defer f.Close()

	var pixels []Pixel
	if err := json.NewDecoder(f).Decode(&pixels); err == nil {
		s.updateCanvas(pixels)

		s.canvasMu.Lock()
		s.isDirty = false
		s.canvasMu.Unlock()
	}
}
