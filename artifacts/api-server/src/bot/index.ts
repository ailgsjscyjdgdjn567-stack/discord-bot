import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  GuildMember,
} from "discord.js";
import { logger } from "../lib/logger";
import { openai } from "@workspace/integrations-openai-ai-server";

const token = process.env["DISCORD_BOT_TOKEN"];
if (!token) {
  throw new Error("DISCORD_BOT_TOKEN is required but not set.");
}

export const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.GuildMember],
});

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Проверить задержку бота"),

  new SlashCommandBuilder()
    .setName("help")
    .setDescription("Показать список всех команд"),

  new SlashCommandBuilder()
    .setName("info")
    .setDescription("Информация о сервере"),

  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Задать вопрос ИИ")
    .addStringOption((opt) =>
      opt
        .setName("вопрос")
        .setDescription("Твой вопрос")
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Забанить пользователя")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((opt) =>
      opt.setName("пользователь").setDescription("Кого забанить").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("причина").setDescription("Причина бана").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("mute")
    .setDescription("Замьютить пользователя (тайм-аут)")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) =>
      opt.setName("пользователь").setDescription("Кого замьютить").setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName("минуты")
        .setDescription("На сколько минут (макс 40320 = 4 недели)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(40320)
    )
    .addStringOption((opt) =>
      opt.setName("причина").setDescription("Причина мута").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("unmute")
    .setDescription("Снять мут с пользователя")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) =>
      opt.setName("пользователь").setDescription("У кого снять мут").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Кикнуть пользователя")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((opt) =>
      opt.setName("пользователь").setDescription("Кого кикнуть").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("причина").setDescription("Причина кика").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Удалить сообщения в канале")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((opt) =>
      opt
        .setName("количество")
        .setDescription("Сколько сообщений удалить (1-100)")
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    ),

  new SlashCommandBuilder()
    .setName("role")
    .setDescription("Выдать или снять роль у пользователя")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption((opt) =>
      opt.setName("пользователь").setDescription("Пользователь").setRequired(true)
    )
    .addRoleOption((opt) =>
      opt.setName("роль").setDescription("Роль для выдачи/снятия").setRequired(true)
    ),
];

async function registerCommands(guildId: string) {
  const rest = new REST({ version: "10" }).setToken(token!);
  const clientId = client.user!.id;
  await rest.put(Routes.applicationGuildCommands(clientId, guildId), {
    body: commands.map((c) => c.toJSON()),
  });
  logger.info({ guildId }, "Slash commands registered");
}

client.once("ready", async () => {
  logger.info({ tag: client.user?.tag }, "Discord bot ready");
  for (const guild of client.guilds.cache.values()) {
    try {
      await registerCommands(guild.id);
    } catch (err) {
      logger.error({ err, guildId: guild.id }, "Failed to register commands");
    }
  }
});

client.on("guildCreate", async (guild) => {
  try {
    await registerCommands(guild.id);
  } catch (err) {
    logger.error({ err, guildId: guild.id }, "Failed to register commands on join");
  }
});

client.on("guildMemberAdd", async (member) => {
  try {
    const channel = member.guild.systemChannel;
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("Добро пожаловать! 🎉")
      .setDescription(
        `Привет, ${member}! Рады видеть тебя на сервере **${member.guild.name}**.\nПосмотри правила и наслаждайся!`
      )
      .setThumbnail(member.user.displayAvatarURL())
      .setFooter({ text: `Участник #${member.guild.memberCount}` })
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (err) {
    logger.error({ err }, "Failed to send welcome message");
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  try {
    if (commandName === "ping") {
      const latency = Date.now() - interaction.createdTimestamp;
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle("🏓 Понг!")
            .addFields(
              { name: "Задержка бота", value: `${latency}мс`, inline: true },
              { name: "API задержка", value: `${Math.round(client.ws.ping)}мс`, inline: true }
            ),
        ],
      });
    }

    else if (commandName === "help") {
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("📖 Список команд")
            .addFields(
              { name: "/ping", value: "Проверить задержку бота", inline: false },
              { name: "/help", value: "Показать этот список", inline: false },
              { name: "/info", value: "Информация о сервере", inline: false },
              { name: "/ask <вопрос>", value: "Задать вопрос ИИ", inline: false },
              { name: "/ban <пользователь> [причина]", value: "Забанить участника (требует право Ban Members)", inline: false },
              { name: "/kick <пользователь> [причина]", value: "Кикнуть участника (требует право Kick Members)", inline: false },
              { name: "/mute <пользователь> <минуты> [причина]", value: "Замьютить участника (требует право Moderate Members)", inline: false },
              { name: "/unmute <пользователь>", value: "Снять мут (требует право Moderate Members)", inline: false },
              { name: "/purge <количество>", value: "Удалить сообщения (требует право Manage Messages)", inline: false },
              { name: "/role <пользователь> <роль>", value: "Выдать/снять роль (требует право Manage Roles)", inline: false },
            )
            .setFooter({ text: "Бот создан с помощью Replit" }),
        ],
      });
    }

    else if (commandName === "info") {
      const guild = interaction.guild!;
      const owner = await guild.fetchOwner();
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xfee75c)
            .setTitle(`🏠 ${guild.name}`)
            .setThumbnail(guild.iconURL())
            .addFields(
              { name: "Владелец", value: `${owner.user.tag}`, inline: true },
              { name: "Участников", value: `${guild.memberCount}`, inline: true },
              { name: "Каналов", value: `${guild.channels.cache.size}`, inline: true },
              { name: "Ролей", value: `${guild.roles.cache.size}`, inline: true },
              { name: "Создан", value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:D>`, inline: true },
            )
            .setTimestamp(),
        ],
      });
    }

    else if (commandName === "ask") {
      const question = interaction.options.getString("вопрос", true);
      await interaction.deferReply();

      const response = await openai.chat.completions.create({
        model: "gpt-5.2",
        max_completion_tokens: 8192,
        messages: [
          {
            role: "system",
            content:
              "Ты полезный ИИ-ассистент в Discord. Отвечай кратко и по делу, используй Discord Markdown для форматирования.",
          },
          { role: "user", content: question },
        ],
      });

      const answer = response.choices[0]?.message?.content ?? "Не удалось получить ответ.";
      const truncated = answer.length > 4000 ? answer.slice(0, 3997) + "..." : answer;

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x5865f2)
            .setTitle("🤖 Ответ ИИ")
            .setDescription(truncated)
            .setFooter({ text: `Вопрос: ${question.slice(0, 80)}` }),
        ],
      });
    }

    else if (commandName === "ban") {
      const target = interaction.options.getMember("пользователь") as GuildMember | null;
      const reason = interaction.options.getString("причина") ?? "Причина не указана";

      if (!target) {
        await interaction.reply({ content: "❌ Пользователь не найден.", ephemeral: true });
        return;
      }

      if (!target.bannable) {
        await interaction.reply({ content: "❌ Не могу забанить этого пользователя.", ephemeral: true });
        return;
      }

      await target.ban({ reason });
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xed4245)
            .setTitle("🔨 Пользователь забанен")
            .addFields(
              { name: "Пользователь", value: `${target.user.tag}`, inline: true },
              { name: "Причина", value: reason, inline: true }
            ),
        ],
      });
    }

    else if (commandName === "kick") {
      const target = interaction.options.getMember("пользователь") as GuildMember | null;
      const reason = interaction.options.getString("причина") ?? "Причина не указана";

      if (!target) {
        await interaction.reply({ content: "❌ Пользователь не найден.", ephemeral: true });
        return;
      }

      if (!target.kickable) {
        await interaction.reply({ content: "❌ Не могу кикнуть этого пользователя.", ephemeral: true });
        return;
      }

      await target.kick(reason);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xffa500)
            .setTitle("👢 Пользователь кикнут")
            .addFields(
              { name: "Пользователь", value: `${target.user.tag}`, inline: true },
              { name: "Причина", value: reason, inline: true }
            ),
        ],
      });
    }

    else if (commandName === "mute") {
      const target = interaction.options.getMember("пользователь") as GuildMember | null;
      const minutes = interaction.options.getInteger("минуты", true);
      const reason = interaction.options.getString("причина") ?? "Причина не указана";

      if (!target) {
        await interaction.reply({ content: "❌ Пользователь не найден.", ephemeral: true });
        return;
      }

      if (!target.moderatable) {
        await interaction.reply({ content: "❌ Не могу замьютить этого пользователя.", ephemeral: true });
        return;
      }

      const durationMs = minutes * 60 * 1000;
      await target.timeout(durationMs, reason);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xfee75c)
            .setTitle("🔇 Пользователь замьючен")
            .addFields(
              { name: "Пользователь", value: `${target.user.tag}`, inline: true },
              { name: "Время", value: `${minutes} мин.`, inline: true },
              { name: "Причина", value: reason, inline: false }
            ),
        ],
      });
    }

    else if (commandName === "unmute") {
      const target = interaction.options.getMember("пользователь") as GuildMember | null;

      if (!target) {
        await interaction.reply({ content: "❌ Пользователь не найден.", ephemeral: true });
        return;
      }

      await target.timeout(null);
      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle("🔊 Мут снят")
            .setDescription(`${target.user.tag} может снова говорить.`),
        ],
      });
    }

    else if (commandName === "purge") {
      const amount = interaction.options.getInteger("количество", true);
      const channel = interaction.channel;

      if (!channel || !channel.isTextBased() || channel.isDMBased()) {
        await interaction.reply({ content: "❌ Команда доступна только в текстовых каналах.", ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      const deleted = await (channel as import("discord.js").TextChannel).bulkDelete(amount, true);
      await interaction.editReply({
        content: `✅ Удалено **${deleted.size}** сообщений.`,
      });
    }

    else if (commandName === "role") {
      const target = interaction.options.getMember("пользователь") as GuildMember | null;
      const role = interaction.options.getRole("роль");

      if (!target || !role) {
        await interaction.reply({ content: "❌ Пользователь или роль не найдены.", ephemeral: true });
        return;
      }

      const hasRole = target.roles.cache.has(role.id);

      if (hasRole) {
        await target.roles.remove(role.id);
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xed4245)
              .setTitle("🏷️ Роль снята")
              .setDescription(`Роль **${role.name}** снята у ${target.user.tag}.`),
          ],
        });
      } else {
        await target.roles.add(role.id);
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle("🏷️ Роль выдана")
              .setDescription(`Роль **${role.name}** выдана ${target.user.tag}.`),
          ],
        });
      }
    }
  } catch (err) {
    logger.error({ err, commandName }, "Error handling slash command");
    const errMsg = "❌ Произошла ошибка при выполнении команды.";
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: errMsg }).catch(() => {});
    } else {
      await interaction.reply({ content: errMsg, ephemeral: true }).catch(() => {});
    }
  }
});

export async function startBot() {
  await client.login(token);
}
