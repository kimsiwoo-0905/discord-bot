require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const MAX_COUNT = 50;
const INTERVAL_MS = 800;   
const MAX_MESSAGE_LEN = 1500;

// 유저별 마지막 실행 시간(명령 연타 방지)
const lastUsedAt = new Map(); // userId -> timestamp

// 유저별 진행 상태 (channelId 별)
const runningByUser = new Map(); // userId -> Map(channelId, { stop: boolean })

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

/**
 * ✅ 핵심: channel.send() / channels.fetch() 절대 안 씀
 * interaction.followUp()만 사용해서 Missing Access 우회
 */
async function safeSend(interaction, content) {
  // followUp은 공개 메시지로 보냄(ephemeral: false)
  return interaction.followUp({ content, ephemeral: false });
}

client.once("ready", () => {
  console.log(`로그인됨: ${client.user.tag}`);
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const userId = interaction.user.id;
  const channelId = interaction.channelId;

  // ✅ /도배
  if (interaction.commandName === "도배") {
    const msg = interaction.options.getString("메시지", true);
    const count = interaction.options.getInteger("개수", true);

    if (msg.length > MAX_MESSAGE_LEN) {
      return interaction.reply({
        content: `1500자 이하로 작성해주세요)`,
        ephemeral: true,
      });
    }

    if (count < 1 || count > MAX_COUNT) {
      return interaction.reply({
        content: `개수는1~50로 해주세요.`,
        ephemeral: true,
      });
    }

    // ✅ 유저별 쿨타임(명령 연타 방지)
    const now = Date.now();
    const last = lastUsedAt.get(userId) ?? 0;
    const diff = now - last;
    if (diff < INTERVAL_MS) {
      const left = ((INTERVAL_MS - diff) / 1000).toFixed(1);
      return interaction.reply({
        content: `잠시 후 다시 시도해 주세요.`,
        ephemeral: true,
      });
    }
    lastUsedAt.set(userId, now);

    // 이미 진행 중이면 막기
    const userRun = getUserRunMap(userId);
    if (userRun.has(channelId)) {
      return interaction.reply({
        content: "이미 진행 중이에요.",
        ephemeral: true,
      });
    }

    // 진행 상태 저장
    const state = { stop: false };
    userRun.set(channelId, state);

    // ✅ 3초 제한 피하려고 deferReply 사용 (공개 메시지로)
    await interaction.deferReply({ ephemeral: true });

    // 시작 안내 (여기서 reply 1회)
    await interaction.editReply(
      `도배를 시작합니다.)`
    );

    try {
      for (let i = 0; i < count; i++) {
        const current = getUserRunMap(userId).get(channelId);
        if (!current || current.stop) break;

        await safeSend(interaction, msg);

        if (i !== count - 1) await sleep(INTERVAL_MS);
      }
    } catch (e) {
      console.error("SEND LOOP ERROR:", e?.message || e);
      // 에러나도 상태는 정리
    } finally {
      getUserRunMap(userId).delete(channelId);
    }
  }

  // ✅ /도배중지
  if (interaction.commandName === "도배중지") {
    const userRun = getUserRunMap(userId);

    if (userRun.size === 0) {
      return interaction.reply({
        content: "진행 중인 도배가 없어요.",
        ephemeral: true,
      });
    }

    // 이 유저가 진행 중인 전송 전부 stop
    for (const state of userRun.values()) state.stop = true;
    userRun.clear();

    return interaction.reply({
      content: "도배를 중지했어요.",
      ephemeral: true,
    });
  }
});

client.login(process.env.DISCORD_TOKEN);
