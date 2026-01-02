const fs = require("fs");

// Class Router Sederhana (Pengganti Pepesan)
class SimpleRouter {
  constructor() {
    this.routes = [];
  }

  keyword(trigger, callback) {
    this.routes.push({ trigger, callback });
  }
}

const router = new SimpleRouter();

// Fungsi Helper Menu
const getMenus = () => {
  try {
    if (!fs.existsSync("./menus.json")) return [];
    return JSON.parse(fs.readFileSync("./menus.json", "utf8"));
  } catch (e) {
    return [];
  }
};

// --- DEFINISI MENU ---

// 1. Ping Check
router.keyword("ping", async (ctx) => {
  await ctx.reply("🏓 Pong! Bot Online & Siap.");
});

// 2. Menu Utama
router.keyword("menu", async (ctx) => {
  const menus = getMenus();
  let text = "*🤖 DAFTAR LAYANAN BOT*\n\n";

  if (menus.length === 0) {
    text += "_Belum ada menu yang tersedia._";
  } else {
    menus.forEach((m) => (text += `*${m.key}*. ${m.title}\n`));
  }

  text += "\n_Ketik angka menu untuk memilih._";
  await ctx.reply(text);
});

// 3. Handler Angka (Dinamis)
router.keyword("DYNAMIC_NUMBER", async (ctx) => {
  const menus = getMenus();
  const input = ctx.text; // Input angka dari user
  const found = menus.find((m) => m.key === input);

  if (found) {
    await ctx.reply(`*${found.title}*\n\n${found.response}`);
    return true; // Menandakan match ditemukan
  }
  return false;
});

module.exports = { router };
