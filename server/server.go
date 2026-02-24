package server

import (
	"sync"

	"github.com/gorilla/websocket"
)

const (
	CanvasFile = "public/canvas.json"
	GridSize   = 20
	PixelSize  = 20
)

type Point struct {
	X int
	Y int
}

type Pixel struct {
	X     int    `json:"x"`
	Y     int    `json:"y"`
	Color string `json:"color"`
}

type Server struct {
	CurrentSize int
	canvasMu    sync.RWMutex
	canvasData  map[Point]string
	isDirty     bool

	clientsMu sync.RWMutex
	clients   map[*websocket.Conn]string
	broadcast chan interface{}
}

func NewServer() *Server {
	return &Server{
		canvasData: make(map[Point]string),
		clients:    make(map[*websocket.Conn]string),
		broadcast:  make(chan interface{}, 256),
	}
}

func (s *Server) addClient(conn *websocket.Conn, id string) {
	s.clientsMu.Lock()
	s.clients[conn] = id
	s.clientsMu.Unlock()
}

func (s *Server) removeClient(conn *websocket.Conn) {
	s.clientsMu.Lock()
	delete(s.clients, conn)
	s.clientsMu.Unlock()
}

func (s *Server) clientCount() int {
	s.clientsMu.RLock()
	defer s.clientsMu.RUnlock()
	return len(s.clients)
}

func (s *Server) BroadcastWorker() {
	for msg := range s.broadcast {
		s.clientsMu.RLock()
		for client := range s.clients {
			_ = client.WriteJSON(msg)
		}
		s.clientsMu.RUnlock()
	}
}
