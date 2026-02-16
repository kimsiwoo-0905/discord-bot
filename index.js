require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require("discord.js");

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

const INTERVAL_MS = 1200;
const MAX_MESSAGE_LEN = 1500;
const MAX_COUNT = 50;

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

client.once("ready", () => {
  console.log(`로그인됨: ${client.user.tag}`);
  console.log(`봇 ID: ${client.user.id}`);
});

client.on("interactionCreate", async (interaction) => {
  // ✅ 디버그: interaction 정보 출력
  console.log("=== Interaction 정보 ===");
  console.log("Type:", interaction.type);
  console.log("Channel ID:", interaction.channelId);
  console.log("Guild ID:", interaction.guildId);
  console.log("interaction.channel:", interaction.channel ? "있음" : "없음");
  
  if (interaction.isChatInputCommand()) {
    const userId = interaction.user.id;
    const channelId = interaction.channelId;

    if (interaction.commandName === "도배") {
      const userRun = getUserRunMap(userId);
      if (userRun.has(channelId)) {
        return interaction.reply({
          content: "이미 진행 중이에요.",
          ephemeral: true,
        });
      }

      const modal = new ModalBuilder()
        .setCustomId("dobae_modal")
        .setTitle("도배 설정");

      const msgInput = new TextInputBuilder()
        .setCustomId("dobae_message")
        .setLabel("보낼 메시지 (1500자 이내)")
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(MAX_MESSAGE_LEN)
        .setRequired(true);

      const countInput = new TextInputBuilder()
        .setCustomId("dobae_count")
        .setLabel("반복 횟수 (숫자만 1~50)")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      modal.addComponents(
        new ActionRowBuilder().addComponents(msgInput),
        new ActionRowBuilder().addComponents(countInput)
      );

      return interaction.showModal(modal);
    }

    if (interaction.commandName === "도배중지") {
      const userRun = getUserRunMap(userId);
      if (userRun.size === 0) {
        return interaction.reply({
          content: "진행 중인 도배가 없어요.",
          ephemeral: true,
        });
      }

      for (const state of userRun.values()) {
        state.stop = true;
      }
      userRun.clear();

      return interaction.reply({
        content: "도배를 중지했어요.",
        ephemeral: true,
      });
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId !== "dobae_modal") return;

    const userId = interaction.user.id;
    const channelId = interaction.channelId;

    // ✅ 디버그 출력
    console.log("=== 모달 제출 ===");
    console.log("User ID:", userId);
    console.log("Channel ID:", channelId);

    const message = interaction.fields.getTextInputValue("dobae_message").trim();
    const countStr = interaction.fields.getTextInputValue("dobae_count").trim();

    if (!/^\d+$/.test(countStr)) {
      return interaction.reply({
        content: "숫자만 입력해주세요.",
        ephemeral: true,
      });
    }

    const count = parseInt(countStr, 10);

    if (count < 1 || count > MAX_COUNT) {
      return interaction.reply({
        content: "1~50 사이 숫자만 가능해요.",
        ephemeral: true,
      });
    }

    const userRun = getUserRunMap(userId);
    const state = { stop: false };
    userRun.set(channelId, state);

    await interaction.reply({
      content: `도배를 시작합니다. (${count}회)`,
      ephemeral: true,
    });

    // ✅ 웹훅 생성 방식으로 변경 (가장 확실한 방법)
    let webhook = null;
    
    try {
      // interaction에서 직접 웹훅 가져오기
      const webhooks = await interaction.channel.fetchWebhooks();
      webhook = webhooks.find(wh => wh.owner.id === client.user.id);
      
      // 웹훅이 없으면 생성
      if (!webhook) {
        webhook = await interaction.channel.createWebhook({
          name: '도배봇',
          reason: '메시지 전송용',
        });
        console.log("웹훅 생성 완료");
      } else {
        console.log("기존 웹훅 사용");
      }
    } catch (error) {
      console.error("웹훅 생성/조회 실패:", error);
      
      // 웹훅 실패 시 일반 메시지 전송 시도
      const channel = interaction.channel;
      
      if (!channel) {
        return interaction.followUp({
          content: "채널 정보를 가져올 수 없어요. 봇에게 '채널 보기', '메시지 보내기', '웹훅 관리' 권한을 주세요.",
          ephemeral: true,
        });
      }

      // 일반 전송 방식
      let sentCount = 0;

      for (let i = 0; i < count; i++) {
        const current = getUserRunMap(userId).get(channelId);
        if (!current || current.stop) break;

        try {
          await channel.send(message);
          sentCount++;

          if (sentCount % 5 === 0 && i < count - 1) {
            await sleep(2000);
          } else {
            await sleep(INTERVAL_MS);
          }
        } catch (sendError) {
          console.error(`메시지 전송 실패:`, sendError);
          
          if (i === 0) {
            await interaction.followUp({
              content: `메시지 전송 실패: ${sendError.message}`,
              ephemeral: true,
            });
          }
          break;
        }
      }

      userRun.delete(channelId);

      try {
        await interaction.followUp({
          content: `완료! (총 ${sentCount}개 전송)`,
          ephemeral: true,
        });
      } catch (e) {
        console.log("완료 메시지 전송 실패");
      }
      
      return;
    }

    // ✅ 웹훅으로 메시지 전송
    let sentCount = 0;

    for (let i = 0; i < count; i++) {
      const current = getUserRunMap(userId).get(channelId);
      if (!current || current.stop) break;

      try {
        await webhook.send({
          content: message,
          username: interaction.user.username,
          avatarURL: interaction.user.displayAvatarURL(),
        });
        
        sentCount++;
        console.log(`메시지 전송 ${sentCount}/${count}`);

        if (sentCount % 5 === 0 && i < count - 1) {
          await sleep(2000);
        } else {
          await sleep(INTERVAL_MS);
        }
      } catch (error) {
        console.error(`웹훅 전송 실패 (${i + 1}/${count}):`, error);

        if (error.code === 429) {
          const retryAfter = error.retry_after || 5000;
          console.log(`Rate limit. ${retryAfter}ms 대기...`);
          await sleep(retryAfter);
          i--;
          continue;
        }

        if (i === 0) {
          await interaction.followUp({
            content: `전송 실패: ${error.message}`,
            ephemeral: true,
          });
        }
        break;
      }
    }

    userRun.delete(channelId);

    try {
      await interaction.followUp({
        content: `도배 완료! (총 ${sentCount}개 전송)`,
        ephemeral: true,
      });
    } catch (error) {
      console.log("완료 메시지 전송 실패");
    }
  }
});

client.login(process.env.DISCORD_TOKEN);