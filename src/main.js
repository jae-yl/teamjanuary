import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap/dist/js/bootstrap.bundle.min.js'
import { io } from "socket.io-client";

const socket = io("http://localhost:3000");

// Create chat UI container
const chatContainer = document.createElement("div");
chatContainer.classList.add("p-2"); // Optional padding
chatContainer.innerHTML = `
  <h5>Chat</h5>
  <input type="text" id="username" placeholder="Your name" class="form-control mb-2" />
  <input type="text" id="messageInput" placeholder="Your message..." class="form-control mb-2" />
  <button class="btn btn-primary mb-3" id="sendBtn">Send</button>
  <ul id="messages" class="list-group"></ul>
`;

// Inject chat UI into the existing chat window
const chatWindowBody = document.querySelector("#chat-window-column .card-body");
chatWindowBody.appendChild(chatContainer);

// Setup chat functionality
const usernameInput = document.getElementById("username");
const messageInput = document.getElementById("messageInput");
const sendBtn = document.getElementById("sendBtn");
const messages = document.getElementById("messages");

sendBtn.addEventListener("click", () => {
  const user = usernameInput.value.trim();
  const msg = messageInput.value.trim();
  if (user && msg) {
    socket.emit("send_message", { user, msg });
    appendMessage(`You: ${msg}`);
    messageInput.value = "";
  }
});

socket.on("receive_message", (data) => {
  appendMessage(`${data.user}: ${data.msg}`);
});

function appendMessage(text) {
  const li = document.createElement("li");
  li.className = "list-group-item";
  li.textContent = text;
  messages.appendChild(li);
}

document.getElementById("profile-pic-banner").addEventListener('click', function() {
  console.log("clicked");
});