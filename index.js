require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const MAX_COUNT = 50;
const INTERVAL_MS = 1000; // 1초 간격
const MAX_MESSAGE_LEN = 1500;

const lastUsedAt = new Map(); 
const runningByUser = new Map(); 

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getUserRunMap(userId) {
  let m = runningByUser.get(userId);
  if (!m) {
    m = new Map();
    runningByUser.set(userId, m);
  }
  return m;
}

async function safeSend(interaction, content) {
  const ch =
    interaction.channel ??
    (await interaction.client.channels.fetch(interaction.channelId));

  return ch.send({ content });
}

client.once("ready", () => {
  console.log(`로그인됨: ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;

  if (interaction.commandName === "도배") {
    const msg = interaction.options.getString("메시지", true);
    const count = interaction.options.getInteger("개수", true);

    if (msg.length > MAX_MESSAGE_LEN) {
      return interaction.reply({
        content: `1500자 이내로 작성해주세요.`,
        ephemeral: true,
      });
    }

    if (count < 1 || count > MAX_COUNT) {
      return interaction.reply({
        content: `개수는 1~50 사이로 해주세요.`,
        ephemeral: true,
      });
    }

    const now = Date.now();
    const last = lastUsedAt.get(userId) ?? 0;
    const diff = now - last;
    if (diff < INTERVAL_MS) {
      const left = ((INTERVAL_MS - diff) / 1000).toFixed(1);
      return interaction.reply({
        content: `잠시만 기다려주세요.`,
        ephemeral: true,
      });
    }
    lastUsedAt.set(userId, now);

    const channelId = interaction.channelId;
    const userRun = getUserRunMap(userId);

    if (userRun.has(channelId)) {
      return interaction.reply({
        content: "이미 실행 중이에요.",
        ephemeral: true,
      });
    }

    const state = { stop: false };
    userRun.set(channelId, state);

    await interaction.reply({
      content: `도배를 시작합니다.`,
      ephemeral: true,
    });

    try {
      for (let i = 0; i < count; i++) {
        const current = getUserRunMap(userId).get(channelId);
        if (!current || current.stop) break;

        await safeSend(interaction, msg);

        if (i !== count - 1) await sleep(INTERVAL_MS);
      }
    } catch (e) {
      console.error(e);
    } finally {
      getUserRunMap(userId).delete(channelId);
    }
  }

  if (interaction.commandName === "도배중지") {
    const userRun = getUserRunMap(userId);

    if (userRun.size === 0) {
      return interaction.reply({
        content: "진행 중인 도배가 없어요.",
        ephemeral: true,
      });
    }

    for (const state of userRun.values()) state.stop = true;
    userRun.clear();

    return interaction.reply({
      content: "도배를 중지했어요.",
      ephemeral: true,
    });
  }
});

client.login(process.env.DISCORD_TOKEN);
