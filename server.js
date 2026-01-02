const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
} = require("@whiskeysockets/baileys");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const qrcode = require("qrcode");
const fs = require("fs");
const { v4: uuidv4 } = require("uuid");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.json());
app.use(express.static("public"));

let qrCache = null;
const userSessions = {};

// --- FUNGSI BANTUAN ---
const getMenus = () => {
  try {
    if (!fs.existsSync("./menus.json")) fs.writeFileSync("./menus.json", "[]");
    return JSON.parse(fs.readFileSync("./menus.json", "utf8"));
  } catch (e) {
    return [];
  }
};

const saveMenus = (data) =>
  fs.writeFileSync("./menus.json", JSON.stringify(data, null, 2));

const getChildren = (parentId = null) => {
  const menus = getMenus();
  return menus.filter((m) => m.parentId === parentId);
};

// --- API ROUTES ---
app.get("/api/menus", (req, res) => res.json(getMenus()));

app.post("/api/menus", (req, res) => {
  const { id, key, title, response, parentId, type } = req.body;
  let menus = getMenus();

  let keyArray = [];
  if (typeof key === "string") {
    keyArray = key.split(",").map((k) => k.trim().toLowerCase());
  } else {
    keyArray = key;
  }

  const newMenuData = {
    id: id || uuidv4(),
    key: keyArray,
    title,
    response: response || "",
    parentId: parentId || null,
    type: type || "response",
  };

  if (id) {
    const index = menus.findIndex((m) => m.id === id);
    if (index >= 0) menus[index] = { ...menus[index], ...newMenuData };
  } else {
    menus.push(newMenuData);
  }

  saveMenus(menus);
  res.json({ success: true });
});

app.delete("/api/menus/:id", (req, res) => {
  let menus = getMenus();
  const idsToDelete = [req.params.id];

  const findChildren = (pid) =>
    menus.filter((m) => m.parentId === pid).map((m) => m.id);
  let children = findChildren(req.params.id);
  while (children.length > 0) {
    idsToDelete.push(...children);
    let nextChildren = [];
    children.forEach((c) => {
      nextChildren.push(...findChildren(c));
    });
    children = nextChildren;
  }

  menus = menus.filter((m) => !idsToDelete.includes(m.id));
  saveMenus(menus);
  res.json({ success: true });
});

app.post("/api/reset", (req, res) => {
  if (fs.existsSync("./auth_info"))
    fs.rmSync("./auth_info", { recursive: true, force: true });
  qrCache = null;
  res.json({ success: true });
  setTimeout(() => process.exit(0), 1000);
});

// --- LOGIKA UTAMA BOT ---

async function handleHierarchyLogic(sock, msg) {
  const remoteJid = msg.key.remoteJid;
  let text = (
    msg.message.conversation ||
    msg.message.extendedTextMessage?.text ||
    ""
  ).trim();

  if (!text) return;
  text = text.toLowerCase();

  const reply = async (txt) => {
    if (!txt) return;
    await sock.sendMessage(remoteJid, { text: txt });
  };

  // Reset ke Menu Utama
  if (["menu", "start", "halo", "hi", "tes", "p"].includes(text)) {
    userSessions[remoteJid] = null;
    return sendMenuDisplay(remoteJid, null, reply);
  }

  const currentParentId = userSessions[remoteJid] || null;

  // Logic Kembali / Back
  if ((text === "0" || text === "kembali") && currentParentId !== null) {
    const menus = getMenus();
    const currentMenu = menus.find((m) => m.id === currentParentId);
    userSessions[remoteJid] = currentMenu ? currentMenu.parentId : null;
    return sendMenuDisplay(remoteJid, userSessions[remoteJid], reply);
  }

  // Logic Pencarian Menu
  const availableOptions = getChildren(currentParentId);
  const selectedOption = availableOptions.find((m) => {
    return Array.isArray(m.key) && m.key.includes(text);
  });

  if (selectedOption) {
    if (selectedOption.response) {
      await reply(selectedOption.response);
    }

    if (selectedOption.type === "folder") {
      userSessions[remoteJid] = selectedOption.id;
      setTimeout(() => {
        sendMenuDisplay(remoteJid, selectedOption.id, reply);
      }, 500);
    }
  }
}

async function sendMenuDisplay(remoteJid, parentId, replyFunc) {
  const children = getChildren(parentId);

  if (children.length === 0) {
    if (parentId !== null)
      await replyFunc("_Belum ada sub-menu di sini._\n\n0. Kembali");
    return;
  }

  let titleHeader = "MENU UTAMA";
  if (parentId) {
    const menus = getMenus();
    const parent = menus.find((m) => m.id === parentId);
    if (parent) titleHeader = parent.title.toUpperCase();
  }

  let text = `*🤖 ${titleHeader}*\n`;
  text += "------------------\n";

  children.forEach((m) => {
    const icon = m.type === "folder" ? "📂" : "📄";
    const mainKey = m.key[0];
    text += `${mainKey}. ${icon} ${m.title}\n`;
  });

  text += "------------------\n";
  if (parentId !== null) text += "0. 🔙 Kembali\n";
  text += "Ketik *menu* untuk kembali ke awal.";

  await replyFunc(text);
}

// --- STARTUP ---
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth_info");
  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true,
    browser: ["BotManager", "Chrome", "1.0.0"],
  });

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      qrCache = await qrcode.toDataURL(qr);
      io.emit("qr", qrCache);
      io.emit("status", "Menunggu Scan");
    }

    if (connection === "open") {
      qrCache = null;
      io.emit("status", "Terhubung");
      console.log("✅ WhatsApp Terhubung!");
    }

    if (connection === "close") {
      io.emit("status", "Terputus");
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !==
        DisconnectReason.loggedOut;
      if (shouldReconnect) startBot();
    }
  });

  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("messages.upsert", async (m) => {
    try {
      const msg = m.messages[0];
      if (
        !msg.message ||
        msg.key.fromMe ||
        msg.key.remoteJid === "status@broadcast"
      )
        return;
      await handleHierarchyLogic(sock, msg);
    } catch (err) {
      console.error("Handler Error:", err);
    }
  });
}

io.on("connection", (socket) => {
  socket.emit("status", "Cek Status...");
  if (qrCache) socket.emit("qr", qrCache);
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`🚀 Server Berjalan: http://localhost:${PORT}`);
  startBot();
});
