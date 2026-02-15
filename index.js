require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const MAX_COUNT = 50;
const INTERVAL_MS = 500; // 2초 간격
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
  try {
    if (interaction.channel) {
      return await interaction.channel.send({ content });
    }

    const ch = await interaction.client.channels.fetch(interaction.channelId);
    return await ch.send({ content });
  } catch (e) {
    const msg =
      e?.rawError?.message ||
      e?.message ||
      "Unknown error";

    console.error("SEND ERROR:", msg);

    // 사용자에게도 이유 표시
    try {
      await interaction.followUp({
        content: `전송 실패: ${msg}`,
        ephemeral: true,
      });
    } catch {}

    throw e;
  }
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
        content: `메시지가 너무 길어요.`,
        ephemeral: true,
      });
    }

    if (count < 1 || count > MAX_COUNT) {
      return interaction.reply({
        content: `개수는 1 ~ ${MAX_COUNT} 사이만 가능해요.`,
        ephemeral: true,
      });
    }

    const now = Date.now();
    const last = lastUsedAt.get(userId) ?? 0;
    const diff = now - last;
    if (diff < INTERVAL_MS) {
      const left = ((INTERVAL_MS - diff) / 1000).toFixed(1);
      return interaction.reply({
        content: `잠시 후 다시 시도해 주세요. (${left}초)`,
        ephemeral: true,
      });
    }
    lastUsedAt.set(userId, now);

    const channelId = interaction.channelId;
    const userRun = getUserRunMap(userId);

    if (userRun.has(channelId)) {
      return interaction.reply({
        content: "이미 여기에서 실행 중이에요. /도배중지로 멈출 수 있어요.",
        ephemeral: true,
      });
    }

    const state = { stop: false };
    userRun.set(channelId, state);

    await interaction.reply({
      content: `전송 시작! ${INTERVAL_MS / 1000}초 간격으로 ${count}번 보냅니다.`,
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
      // safeSend에서 이미 이유 출력/표시함
      console.error(e);
    } finally {
      getUserRunMap(userId).delete(channelId);
    }
  }

  if (interaction.commandName === "도배중지") {
    const userRun = getUserRunMap(userId);

    if (userRun.size === 0) {
      return interaction.reply({
        content: "진행 중인 전송이 없어요.",
        ephemeral: true,
      });
    }

    for (const state of userRun.values()) state.stop = true;
    userRun.clear();

    return interaction.reply({
      content: "전송을 중지했어요.",
      ephemeral: true,
    });
  }
});

client.login(process.env.DISCORD_TOKEN);
