/**
 * PIXEL STUDIO PRO - Core Logic (Corrected Version)
 */

// 1. Inisialisasi User & State
let myName = prompt("Your name:", "Player") || "Guest";
document.getElementById("myNameDisplay").innerText = myName;

let gridSize = 20;
const pixelSize = 20;
let pixels = {};
let undoStack = [];
let redoStack = [];
let isDrawing = false;
let myID = null;
let currentMode = 'pencil'; 
let showGrid = true;
let remoteCursors = {};
let hoveredPixel = null;
let unreadCount = 0;

// State Zoom & Pan
let scale = 1;
let translateX = 0;
let translateY = 0;
let isPanning = false;
let startX, startY;

// 2. Elemen DOM
const ws = new WebSocket(`ws://${window.location.host}/ws`);
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const colorPicker = document.getElementById("colorPicker");
const userCountEl = document.getElementById("userCount");
const wrapper = document.getElementById("wrapper");

// 3. Setup Kanvas Awal
canvas.width = gridSize * pixelSize;
canvas.height = gridSize * pixelSize;

/**
 * WEBSOCKET HANDLER
 */
ws.onmessage = (e) => {
    const data = JSON.parse(e.data);
    
    if (data.type === "init") {
        myID = data.id;
    } else if (data.type === "presence") {
        userCountEl.innerText = data.online_users;
    } else if (data.type === "cursor" && data.id !== myID) {
        updateRemoteCursor(data);
    } else if (data.type === "cursor_remove") {
        removeRemoteCursor(data.id);
    } else if (data.type === "resize") {
        applyResize(data.size, false);
    } else if (data.type === "chat") {
        displayChatMessage(data.user, data.text);
    } else if (Array.isArray(data)) {
        if (data.length === 0) {
            pixels = {};
        } else {
            data.forEach(p => {
                if (p.color === "") delete pixels[`${p.x},${p.y}`];
                else pixels[`${p.x},${p.y}`] = p.color;
            });
        }
        drawGrid();
    }
};

/**
 * CORE RENDERING
 */
function drawGrid() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (showGrid) {
        // Checkerboard background
        ctx.fillStyle = "#f0f0f0";
        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                if ((i + j) % 2 === 1) ctx.fillRect(i * pixelSize, j * pixelSize, pixelSize, pixelSize);
            }
        }
        // Grid lines
        ctx.strokeStyle = "rgba(0, 0, 0, 0.08)";
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= gridSize; i++) {
            ctx.beginPath(); ctx.moveTo(i * pixelSize, 0); ctx.lineTo(i * pixelSize, canvas.height); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0, i * pixelSize); ctx.lineTo(canvas.width, i * pixelSize); ctx.stroke();
        }
    } else {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // Render Pixels
    for (let key in pixels) {
        const [x, y] = key.split(",");
        ctx.fillStyle = pixels[key];
        ctx.fillRect(parseInt(x) * pixelSize, parseInt(y) * pixelSize, pixelSize, pixelSize);
    }

    // Render Hover Preview (Kotak bayangan saat mouse bergerak)
    if (hoveredPixel && !isDrawing && !isPanning) {
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = currentMode === 'eraser' ? "#ffffff" : colorPicker.value;
        ctx.fillRect(hoveredPixel.x * pixelSize, hoveredPixel.y * pixelSize, pixelSize, pixelSize);
        ctx.globalAlpha = 1.0;
        ctx.strokeStyle = "rgba(0,0,0,0.2)";
        ctx.strokeRect(hoveredPixel.x * pixelSize, hoveredPixel.y * pixelSize, pixelSize, pixelSize);
    }
}

/**
 * COORDINATE & TRANSFORM SYSTEM
 */
function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    // Rumus menghitung posisi pixel yang tepat meski sedang di-zoom/pan
    const x = Math.floor((e.clientX - rect.left) / (pixelSize * scale));
    const y = Math.floor((e.clientY - rect.top) / (pixelSize * scale));
    return { x, y };
}

function updateCanvasTransform() {
    // Menggunakan translate3d untuk akselerasi hardware
    canvas.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`;
}

/**
 * TOOLS & MODES
 */
function setMode(mode) {
    currentMode = mode;
    document.getElementById("btnPencil").classList.toggle("active", mode === 'pencil');
    document.getElementById("btnEraser").classList.toggle("active", mode === 'eraser');
    canvas.style.cursor = mode === 'eraser' ? "cell" : "crosshair";
}

function toggleGrid() {
    showGrid = document.getElementById("gridToggle").checked;
    drawGrid();
}

function applyResize(size, broadcast) {
    gridSize = size;
    canvas.width = gridSize * pixelSize;
    canvas.height = gridSize * pixelSize;
    document.getElementById("inputGridSize").value = size;
    if (broadcast && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", size: size }));
    }
    drawGrid();
}

function resizeCanvas() {
    const newSize = parseInt(document.getElementById("inputGridSize").value);
    if (newSize >= 5 && newSize <= 100 && confirm(`Resize to ${newSize}x${newSize} for everyone?`)) {
        applyResize(newSize, true);
    }
}

/**
 * DRAWING LOGIC
 */
function paint(e) {
    const pos = getMousePos(e);
    if (pos.x < 0 || pos.x >= gridSize || pos.y < 0 || pos.y >= gridSize) return;

    const key = `${pos.x},${pos.y}`;
    const color = currentMode === 'eraser' ? "" : colorPicker.value;

    if (currentMode === 'eraser') {
        if (pixels[key]) {
            delete pixels[key];
            sendUpdate([{ x: pos.x, y: pos.y, color: "" }]);
        }
    } else {
        if (pixels[key] !== color) {
            pixels[key] = color;
            sendUpdate([{ x: pos.x, y: pos.y, color }]);
        }
    }
    drawGrid();
}

function sendUpdate(data) {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

/**
 * MOUSE & INTERACTION EVENTS
 */
canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) { // Klik Kiri: Menggambar
        e.preventDefault();
        isDrawing = true;
        saveState();
        paint(e);
    }
});

wrapper.addEventListener("mousedown", (e) => {
    if (e.button === 1 || e.button === 2) { // Klik Tengah/Kanan: Panning (Geser)
        isPanning = true;
        startX = e.clientX - translateX;
        startY = e.clientY - translateY;
        wrapper.style.cursor = "grabbing";
        e.preventDefault();
    }
});

window.addEventListener("mousemove", (e) => {
    // 1. Logika Geser Kanvas
    if (isPanning) {
        translateX = e.clientX - startX;
        translateY = e.clientY - startY;
        updateCanvasTransform();
        return;
    }

    // 2. Logika Update Hover & Kursor
    const pos = getMousePos(e);
    const rect = canvas.getBoundingClientRect();

    if (pos.x >= 0 && pos.x < gridSize && pos.y >= 0 && pos.y < gridSize) {
        hoveredPixel = pos;
    } else {
        hoveredPixel = null; 
    }

    // Kirim posisi kursor ke pemain lain
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ 
            type: "cursor", 
            user: myName, 
            x: e.clientX - rect.left, 
            y: e.clientY - rect.top 
        }));
    }

    // 3. Logika Menggambar
    if (isDrawing) {
        paint(e);
    } else {
        drawGrid(); // Render ulang untuk hover preview
    }
});

window.addEventListener("mouseup", () => {
    if (isDrawing) {
        isDrawing = false;
        syncToDB();
    }
    isPanning = false;
    wrapper.style.cursor = "grab";
});

wrapper.addEventListener("wheel", (e) => {
    e.preventDefault();
    const zoomSpeed = 0.1;
    if (e.deltaY < 0) scale = Math.min(scale + zoomSpeed, 10);
    else scale = Math.max(scale - zoomSpeed, 0.1);
    updateCanvasTransform();
}, { passive: false });

wrapper.addEventListener("contextmenu", e => e.preventDefault());

/**
 * CHAT & NOTIFICATION
 */
function sendChatMessage() {
    const input = document.getElementById("chatInput");
    const text = input.value.trim();
    if (text !== "" && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "chat", user: myName, text: text }));
        input.value = "";
    }
}

document.getElementById("chatInput").addEventListener("keypress", (e) => {
    if (e.key === "Enter") sendChatMessage();
});

function toggleChatPopup() {
    const chatPopup = document.getElementById("chatPopup");
    const chatBadge = document.getElementById("chatBadge");
    chatPopup.classList.toggle("active");
    if (chatPopup.classList.contains("active")) {
        unreadCount = 0;
        chatBadge.style.display = "none";
        document.title = "Pixel Studio Pro"; 
        setTimeout(() => document.getElementById("chatInput").focus(), 300);
    }
}

function displayChatMessage(user, text) {
    const chatPopup = document.getElementById("chatPopup");
    const chatMessages = document.getElementById("chatMessages");
    const chatBadge = document.getElementById("chatBadge");
    const isMe = (user === myName);
    
    const msgDiv = document.createElement("div");
    msgDiv.className = `chat-bubble ${isMe ? 'msg-right' : 'msg-left'}`;
    msgDiv.innerHTML = `<span class="msg-user">${isMe ? 'Me' : user}</span><div>${text}</div>`;
    chatMessages.appendChild(msgDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    if (!chatPopup.classList.contains("active") && !isMe) {
        unreadCount++;
        chatBadge.innerText = unreadCount;
        chatBadge.style.display = "flex"; 
        document.title = `(${unreadCount}) Pesan Baru | Pixel Studio Pro`;
    }
}

/**
 * REMOTE CURSORS
 */
function updateRemoteCursor(data) {
    let cursor = remoteCursors[data.id];
    if (!cursor) {
        cursor = document.createElement("div");
        cursor.className = "remote-cursor";
        cursor.innerHTML = `<div class="cursor-pointer"></div><div class="cursor-label">${data.user}</div>`;
        wrapper.appendChild(cursor);
        remoteCursors[data.id] = cursor;
    }
    cursor.style.left = (data.x - 7) + "px";
    cursor.style.top = (data.y - 7) + "px";
}

function removeRemoteCursor(id) {
    if (remoteCursors[id]) {
        remoteCursors[id].remove();
        delete remoteCursors[id];
    }
}

/**
 * HISTORY & PERSISTENCE
 */
function saveState() {
    undoStack.push(JSON.stringify(pixels));
    if (undoStack.length > 50) undoStack.shift();
    redoStack = [];
}

function execUndo() {
    if (undoStack.length === 0) return;
    redoStack.push(JSON.stringify(pixels));
    pixels = JSON.parse(undoStack.pop());
    drawGrid();
    broadcastFull();
}

function execRedo() {
    if (redoStack.length === 0) return;
    undoStack.push(JSON.stringify(pixels));
    pixels = JSON.parse(redoStack.pop());
    drawGrid();
    broadcastFull();
}

function broadcastFull() {
    const data = Object.keys(pixels).map(k => {
        const [x, y] = k.split(",");
        return { x: Number(x), y: Number(y), color: pixels[k] };
    });
    sendUpdate(data.length ? data : []);
    syncToDB();
}

function syncToDB() {
    const data = Object.keys(pixels).map(k => {
        const [x, y] = k.split(",");
        return { x: Number(x), y: Number(y), color: pixels[k] };
    });
    fetch("/api/save", { 
        method: "POST", 
        headers: { "Content-Type": "application/json" }, 
        body: JSON.stringify(data) 
    });
}

function execDeleteAll() {
    if (confirm("Delete all pixels?")) {
        saveState();
        pixels = {};
        drawGrid();
        sendUpdate([]);
        syncToDB();
    }
}

function execExport() {
    window.open("/api/export", "_blank");
}

/**
 * STARTUP
 */
fetch("/api/load")
    .then(res => res.json())
    .then(data => {
        pixels = {};
        data.forEach(p => pixels[`${p.x},${p.y}`] = p.color);
        drawGrid();
    })
    .catch(err => console.error("Error loading data:", err));

setMode('pencil');