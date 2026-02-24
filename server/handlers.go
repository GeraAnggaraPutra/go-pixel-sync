package server

import (
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"log"
	"net/http"
	"strconv"

	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func (s *Server) WSHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("Failed to upgrade connection: %v", err)
		return
	}

	connID := fmt.Sprintf("%p", conn)
	s.addClient(conn, connID)

	// Get current size safely
	s.canvasMu.RLock()
	currentSize := s.CurrentSize
	if currentSize == 0 {
		currentSize = 20 // Default fallback
	}
	s.canvasMu.RUnlock()

	// Send init with current size
	conn.WriteJSON(map[string]interface{}{
		"type": "init",
		"id":   connID,
		"size": currentSize,
	})

	s.broadcast <- map[string]interface{}{"type": "presence", "online_users": s.clientCount()}

	defer func() {
		s.removeClient(conn)
		s.broadcast <- map[string]interface{}{"type": "presence", "online_users": s.clientCount()}
		s.broadcast <- map[string]interface{}{"type": "cursor_remove", "id": connID}
		conn.Close()
	}()

	for {
		var raw json.RawMessage
		if err := conn.ReadJSON(&raw); err != nil {
			break
		}

		s.processMessage(raw, connID)
	}
}

func (s *Server) processMessage(raw []byte, connID string) {
	var incomingPixels []Pixel
	if err := json.Unmarshal(raw, &incomingPixels); err == nil && len(incomingPixels) > 0 {
		s.updateCanvas(incomingPixels)
		s.broadcast <- incomingPixels
		return
	} else if err == nil && len(incomingPixels) == 0 {
		s.clearCanvas()
		s.broadcast <- incomingPixels
		return
	}

	var msg map[string]interface{}
	if err := json.Unmarshal(raw, &msg); err == nil {
		if msgType, ok := msg["type"].(string); ok {
			switch msgType {
			case "cursor":
				msg["id"] = connID
				s.broadcast <- msg
			case "resize":
				// Save new size to server memory
				if sizeVal, ok := msg["size"].(float64); ok { // JSON numbers are parsed as float64
					s.canvasMu.Lock()
					s.CurrentSize = int(sizeVal)
					s.canvasMu.Unlock()
				}
				s.broadcast <- msg
			case "chat":
				s.broadcast <- msg
			}
		}
	}
}

func (s *Server) SaveHandler(w http.ResponseWriter, r *http.Request) {
	var incoming []Pixel
	if err := json.NewDecoder(r.Body).Decode(&incoming); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	s.clearCanvas()
	s.updateCanvas(incoming)
	w.WriteHeader(http.StatusOK)
}

func (s *Server) LoadHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s.getCanvasPixels())
}

func (s *Server) ExportPNGHandler(w http.ResponseWriter, r *http.Request) {
	currentGridSize := GridSize
	if sizeStr := r.URL.Query().Get("size"); sizeStr != "" {
		if parsedSize, err := strconv.Atoi(sizeStr); err == nil {
			currentGridSize = parsedSize
		}
	}

	img := image.NewRGBA(image.Rect(0, 0, currentGridSize*PixelSize, currentGridSize*PixelSize))

	s.canvasMu.RLock()
	for pt, hexColor := range s.canvasData {
		var rCol, gCol, bCol uint8
		if len(hexColor) == 7 && hexColor[0] == '#' {
			fmt.Sscanf(hexColor[1:], "%02x%02x%02x", &rCol, &gCol, &bCol)
		} else {
			continue
		}

		col := color.RGBA{rCol, gCol, bCol, 255}
		startX, startY := pt.X*PixelSize, pt.Y*PixelSize
		for i := 0; i < PixelSize; i++ {
			for j := 0; j < PixelSize; j++ {
				img.Set(startX+i, startY+j, col)
			}
		}
	}
	s.canvasMu.RUnlock()

	w.Header().Set("Content-Type", "image/png")
	if err := png.Encode(w, img); err != nil {
		http.Error(w, "Failed to encode image", http.StatusInternalServerError)
	}
}
