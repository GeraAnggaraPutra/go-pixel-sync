// Initialization & State
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

// Pan & Zoom State
let scale = 1;
let translateX = 0;
let translateY = 0;
let isPanning = false;
let startX, startY;

// DOM Elements & WebSocket
const ws = new WebSocket(`ws://${window.location.host}/ws`);
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const colorPicker = document.getElementById("colorPicker");
const userCountEl = document.getElementById("userCount");
const wrapper = document.getElementById("wrapper");

canvas.width = gridSize * pixelSize;
canvas.height = gridSize * pixelSize;

// WebSocket Handler
ws.onmessage = (e) => {
    const data = JSON.parse(e.data);
    
    if (data.type === "init") {
        myID = data.id;
        if (data.size) {
            applyResize(data.size, false); // Sync canvas size from server
        }
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

// Canvas Rendering
function drawGrid() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    if (showGrid) {
        ctx.fillStyle = "#f0f0f0";
        for (let i = 0; i < gridSize; i++) {
            for (let j = 0; j < gridSize; j++) {
                if ((i + j) % 2 === 1) ctx.fillRect(i * pixelSize, j * pixelSize, pixelSize, pixelSize);
            }
        }
        
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

    for (let key in pixels) {
        const [x, y] = key.split(",");
        ctx.fillStyle = pixels[key];
        ctx.fillRect(parseInt(x) * pixelSize, parseInt(y) * pixelSize, pixelSize, pixelSize);
    }

    if (hoveredPixel && !isDrawing && !isPanning) {
        ctx.globalAlpha = 0.4;
        ctx.fillStyle = currentMode === 'eraser' ? "#ffffff" : colorPicker.value;
        ctx.fillRect(hoveredPixel.x * pixelSize, hoveredPixel.y * pixelSize, pixelSize, pixelSize);
        ctx.globalAlpha = 1.0;
        ctx.strokeStyle = "rgba(0,0,0,0.2)";
        ctx.strokeRect(hoveredPixel.x * pixelSize, hoveredPixel.y * pixelSize, pixelSize, pixelSize);
    }
}

// Helpers
function getMousePos(e) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - rect.left) / (pixelSize * scale));
    const y = Math.floor((e.clientY - rect.top) / (pixelSize * scale));
    return { x, y };
}

function updateCanvasTransform() {
    canvas.style.transform = `translate3d(${translateX}px, ${translateY}px, 0) scale(${scale})`;
    renderAllCursors();
}

// UI Controls
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

    setTimeout(renderAllCursors, 50);
}

function resizeCanvas() {
    const newSize = parseInt(document.getElementById("inputGridSize").value);
    if (newSize >= 5 && newSize <= 100 && confirm(`Resize to ${newSize}x${newSize} for everyone?`)) {
        applyResize(newSize, true);
    }
}

// Drawing Logic
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

// Mouse Events
canvas.addEventListener("mousedown", (e) => {
    if (e.button === 0) {
        e.preventDefault();
        isDrawing = true;
        saveState();
        paint(e);
    }
});

wrapper.addEventListener("mousedown", (e) => {
    if (e.button === 1 || e.button === 2) {
        isPanning = true;
        startX = e.clientX - translateX;
        startY = e.clientY - translateY;
        wrapper.style.cursor = "grabbing";
        e.preventDefault();
    }
});

window.addEventListener("mousemove", (e) => {
    if (isPanning) {
        translateX = e.clientX - startX;
        translateY = e.clientY - startY;
        updateCanvasTransform();
        return;
    }

    const pos = getMousePos(e);

    if (pos.x >= 0 && pos.x < gridSize && pos.y >= 0 && pos.y < gridSize) {
        hoveredPixel = pos;
    } else {
        hoveredPixel = null; 
    }

    if (isDrawing) {
        paint(e);
    } else {
        drawGrid(); 
    }

    if (ws.readyState === WebSocket.OPEN && hoveredPixel) {
        ws.send(JSON.stringify({ 
            type: "cursor", 
            user: myName, 
            x: (hoveredPixel.x * pixelSize) + (pixelSize / 2), 
            y: (hoveredPixel.y * pixelSize) + (pixelSize / 2) 
        }));
    }
});

window.addEventListener("mouseup", () => {
    if (isDrawing) isDrawing = false;
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

// Chat System
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
        document.title = `(${unreadCount}) New Message | Pixel Studio Pro`;
    }
}

// Remote Cursors
function updateRemoteCursor(data) {
    let cursor = remoteCursors[data.id];
    if (!cursor) {
        cursor = document.createElement("div");
        cursor.className = "remote-cursor";
        cursor.innerHTML = `<div class="cursor-pointer"></div><div class="cursor-label">${data.user}</div>`;
        wrapper.appendChild(cursor);
        remoteCursors[data.id] = cursor;
    }
    
    cursor.dataset.x = data.x;
    cursor.dataset.y = data.y;

    renderCursor(cursor);
}

function renderCursor(cursor) {
    const canvasRect = canvas.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    
    const dataX = parseFloat(cursor.dataset.x);
    const dataY = parseFloat(cursor.dataset.y);

    const relativeLeft = (canvasRect.left - wrapperRect.left) + (dataX * scale);
    const relativeTop = (canvasRect.top - wrapperRect.top) + (dataY * scale);

    cursor.style.left = (relativeLeft - 7) + "px";
    cursor.style.top = (relativeTop - 7) + "px";
}

function renderAllCursors() {
    Object.values(remoteCursors).forEach(renderCursor);
}

function removeRemoteCursor(id) {
    if (remoteCursors[id]) {
        remoteCursors[id].remove();
        delete remoteCursors[id];
    }
}

// History Management
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
    window.open(`/api/export?size=${gridSize}`, "_blank");
}

window.addEventListener("resize", renderAllCursors);

// Load Initial Data
fetch("/api/load")
    .then(res => res.json())
    .then(data => {
        pixels = {};
        data.forEach(p => pixels[`${p.x},${p.y}`] = p.color);
        drawGrid();
    })
    .catch(err => console.error("Error loading data:", err));

// Initial Setup
setMode('pencil');