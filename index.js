require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const MAX_COUNT = 50;            
const INTERVAL_MS = 500;       
const USER_COOLDOWN = 500;     
const MAX_MESSAGE_LEN = 1500;

const lastUsed = new Map();      // userId -> timestamp
const running = new Map();       // channelId -> { stop: boolean }

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function safeSend(interaction, content) {
  const channel =
    interaction.channel ??
    (await interaction.client.channels.fetch(interaction.channelId));

  return channel.send({
    content: content,
    allowedMentions: {
      parse: ["users", "roles", "everyone"], // ✅ 전부 허용
      repliedUser: true,
    },
  });
}

client.once("ready", () => {
  console.log(`로그인됨: ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // -------------------------
  // /도배
  // -------------------------
  if (interaction.commandName === "도배") {
    const msg = interaction.options.getString("메시지", true);
    const count = interaction.options.getInteger("개수", true);

    if (msg.length > MAX_MESSAGE_LEN) {
      return interaction.reply({
        content: `1500자 이하로 적어주세요.`,
        ephemeral: true,
      });
    }

    if (count < 1 || count > MAX_COUNT) {
      return interaction.reply({
        content: `1~50 사이로 적어주세요.`,
        ephemeral: true,
      });
    }

    // 유저 쿨타임
    const now = Date.now();
    const last = lastUsed.get(interaction.user.id) ?? 0;
    const leftMs = USER_COOLDOWN - (now - last);

    if (leftMs > 0) {
      return interaction.reply({
        content: `너무 빨라요.`,
        ephemeral: true,
      });
    }

    lastUsed.set(interaction.user.id, now);

    const channelId = interaction.channelId;

    if (running.has(channelId)) {
      return interaction.reply({
        content: "실행 중 입니다.",
        ephemeral: true,
      });
    }

    const state = { stop: false };
    running.set(channelId, state);

    await interaction.reply({
      content: `도배 시작`,
      ephemeral: true,
    });

    try {
      for (let i = 0; i < count; i++) {
        if (state.stop) break;

        await safeSend(interaction, msg);
        if (i !== count - 1) await sleep(INTERVAL_MS);
      }
    } catch (err) {
      console.error("[SendError]", err);
    } finally {
      running.delete(channelId);
    }
  }

  // -------------------------
  // /도배중지
  // -------------------------
  if (interaction.commandName === "도배중지") {
    const state = running.get(interaction.channelId);

    if (!state) {
      return interaction.reply({
        content: "진행 중인 도배가 없어요.",
        ephemeral: true,
      });
    }

    state.stop = true;
    running.delete(interaction.channelId);

    return interaction.reply({
      content: "도배를 중지했어요.",
      ephemeral: true,
    });
  }
});

client.login(process.env.DISCORD_TOKEN);