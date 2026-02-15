require("dotenv").config();
const { REST, Routes } = require("discord.js");

const commands = [
  {
    name: "도배",
    description: "모달에서 메시지/횟수를 입력해 반복 전송합니다",
    type: 1,
    // 서버/DM 모두
    integration_types: [0, 1],
    contexts: [0, 1, 2],
    // ✅ 옵션 완전 제거 (이게 핵심)
  },
  {
    name: "도배중지",
    description: "진행 중인 도배를 중지합니다",
    type: 1,
    integration_types: [0, 1],
    contexts: [0, 1, 2],
  },
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("전역 명령어 갱신 중...");
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
    console.log("갱신 완료!");
  } catch (e) {
    console.error(e);
  }
})();
