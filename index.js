require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const MAX_COUNT = 20;
const INTERVAL_MS = 2000;     // 2초 간격
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
        content: `메시지가 너무 길어요. (${MAX_MESSAGE_LEN}자 이하)`,
        ephemeral: true,
      });
    }

    if (count < 1 || count > MAX_COUNT) {
      return interaction.reply({
        content: `개수는 1 ~ ${MAX_COUNT} 사이만 가능해요.`,
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
        content: `잠시 후 다시 시도해 주세요. (${left}초)`,
        ephemeral: true,
      });
    }
    lastUsedAt.set(userId, now);

    // 이미 진행 중이면 막기
    const userRun = getUserRunMap(userId);
    if (userRun.has(channelId)) {
      return interaction.reply({
        content: "이미 여기에서 진행 중이에요. `/도배중지`로 멈춘 뒤 다시 실행해줘요.",
        ephemeral: true,
      });
    }

    // 진행 상태 저장
    const state = { stop: false };
    userRun.set(channelId, state);

    // ✅ 3초 제한 피하려고 deferReply 사용 (공개 메시지로)
    await interaction.deferReply({ ephemeral: false });

    // 시작 안내 (여기서 reply 1회)
    await interaction.editReply(
      `전송 시작! ${INTERVAL_MS / 1000}초 간격으로 ${count}번 보낼게요. (멈추려면 /도배중지)`
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
        content: "진행 중인 전송이 없어요.",
        ephemeral: true,
      });
    }

    // 이 유저가 진행 중인 전송 전부 stop
    for (const state of userRun.values()) state.stop = true;
    userRun.clear();

    return interaction.reply({
      content: "전송을 중지했어요.",
      ephemeral: true,
    });
  }
});

client.login(process.env.DISCORD_TOKEN);
