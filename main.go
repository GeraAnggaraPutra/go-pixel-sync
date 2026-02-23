package main

import (
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"log"
	"net/http"
	"os"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

type Pixel struct {
	X     int    `json:"x"`
	Y     int    `json:"y"`
	Color string `json:"color"`
}

var (
	canvasData = make(map[string]string)
	mu         sync.RWMutex
	saveQueue  = make(chan struct{}, 100)
	clients    = make(map[*websocket.Conn]string)
	broadcast  = make(chan interface{})
)

const (
	canvasFile = "canvas.json"
	gridSize   = 20
	pixelSize  = 20
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func main() {
	loadCanvasFromFile()
	go autosaveWorker()
	go broadcastWorker()

	http.Handle("/", http.FileServer(http.Dir("./public")))
	http.HandleFunc("/ws", wsHandler)
	http.HandleFunc("/api/save", saveHandler)
	http.HandleFunc("/api/load", loadHandler)
	http.HandleFunc("/api/export", exportPNGHandler)

	log.Println("Server running at :8080")
	log.Fatal(http.ListenAndServe(":8080", nil))
}

func wsHandler(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}

	connID := fmt.Sprintf("%p", conn)

	mu.Lock()
	clients[conn] = connID
	count := len(clients)
	mu.Unlock()

	conn.WriteJSON(map[string]interface{}{"type": "init", "id": connID})
	broadcast <- map[string]interface{}{"type": "presence", "online_users": count}

	defer func() {
		mu.Lock()
		delete(clients, conn)
		count := len(clients)
		mu.Unlock()
		broadcast <- map[string]interface{}{"type": "presence", "online_users": count}
		broadcast <- map[string]interface{}{"type": "cursor_remove", "id": connID}
		conn.Close()
	}()

	for {
		var raw json.RawMessage
		if err := conn.ReadJSON(&raw); err != nil {
			break
		}

		var msg map[string]interface{}
		json.Unmarshal(raw, &msg)

		msgType, ok := msg["type"].(string)
		if ok {
			if msgType == "cursor" {
				msg["id"] = connID
				broadcast <- msg
				continue
			}

			if msgType == "resize" {
				broadcast <- msg
				continue
			}

			if msgType == "chat" {
				broadcast <- msg
				continue
			}
		}

		var incoming []Pixel
		if err := json.Unmarshal(raw, &incoming); err == nil {
			mu.Lock()
			if len(incoming) == 0 {
				canvasData = make(map[string]string)
			} else {
				for _, p := range incoming {
					canvasData[fmt.Sprintf("%d,%d", p.X, p.Y)] = p.Color
				}
			}
			mu.Unlock()
			broadcast <- incoming

			select {
			case saveQueue <- struct{}{}:
			default:
			}
		}
	}
}

func broadcastWorker() {
	for msg := range broadcast {
		mu.RLock()
		for client := range clients {
			client.WriteJSON(msg)
		}
		mu.RUnlock()
	}
}

func saveHandler(w http.ResponseWriter, r *http.Request) {
	var incoming []Pixel
	if err := json.NewDecoder(r.Body).Decode(&incoming); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	mu.Lock()
	canvasData = make(map[string]string)
	for _, p := range incoming {
		canvasData[fmt.Sprintf("%d,%d", p.X, p.Y)] = p.Color
	}
	mu.Unlock()
}

func loadHandler(w http.ResponseWriter, r *http.Request) {
	mu.RLock()
	defer mu.RUnlock()
	pixels := []Pixel{}
	for k, v := range canvasData {
		var x, y int
		fmt.Sscanf(k, "%d,%d", &x, &y)
		pixels = append(pixels, Pixel{X: x, Y: y, Color: v})
	}

	json.NewEncoder(w).Encode(pixels)
}

func autosaveWorker() {
	for range saveQueue {
		time.Sleep(2 * time.Second)
		mu.RLock()
		pixels := []Pixel{}
		for k, v := range canvasData {
			var x, y int
			fmt.Sscanf(k, "%d,%d", &x, &y)
			pixels = append(pixels, Pixel{X: x, Y: y, Color: v})
		}
		mu.RUnlock()

		f, _ := os.Create(canvasFile)
		json.NewEncoder(f).Encode(pixels)
		f.Close()
	}
}

func loadCanvasFromFile() {
	f, err := os.Open(canvasFile)
	if err != nil {
		return
	}
	defer f.Close()

	var pixels []Pixel
	json.NewDecoder(f).Decode(&pixels)

	mu.Lock()
	for _, p := range pixels {
		canvasData[fmt.Sprintf("%d,%d", p.X, p.Y)] = p.Color
	}
	mu.Unlock()
}

func exportPNGHandler(w http.ResponseWriter, r *http.Request) {
	img := image.NewRGBA(image.Rect(0, 0, gridSize*pixelSize, gridSize*pixelSize))
	mu.RLock()
	for k, v := range canvasData {
		var x, y int
		fmt.Sscanf(k, "%d,%d", &x, &y)
		var r_col, g_col, b_col uint8
		fmt.Sscanf(v[1:], "%02x%02x%02x", &r_col, &g_col, &b_col)
		col := color.RGBA{r_col, g_col, b_col, 255}
		for i := 0; i < pixelSize; i++ {
			for j := 0; j < pixelSize; j++ {
				img.Set(x*pixelSize+i, y*pixelSize+j, col)
			}
		}
	}

	mu.RUnlock()
	w.Header().Set("Content-Type", "image/png")
	png.Encode(w, img)
}
