require("dotenv").config();
const { REST, Routes } = require("discord.js");

// contexts:
// 0 = GUILD (서버)
// 1 = BOT_DM (봇과 개인 DM)
// 2 = PRIVATE_CHANNEL (사용자 설치 채널)

// integration_types:
// 0 = GUILD_INSTALL (서버 설치)
// 1 = USER_INSTALL (사용자 설치)

const commands = [
  {
    name: "도배",
    description: "메시지를 반복 전송합니다 (최대 50회)",
    type: 1,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    options: [
      {
        name: "메시지",
        description: "보낼 메시지",
        type: 3, // STRING
        required: true,
      },
      {
        name: "개수",
        description: "반복 횟수 (1~50)",
        type: 4, // INTEGER
        required: true,
      },
    ],
  },
  {
    name: "도배중지",
    description: "도배를 중지합니다",
    type: 1,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("전역 슬래시 명령어 등록 중...");

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );

    console.log("명령어 등록 완료!");
  } catch (error) {
    console.error(error);
  }
})();
