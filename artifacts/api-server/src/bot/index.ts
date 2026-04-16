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
  Message,
} from "discord.js";
import { logger } from "../lib/logger";
import { openai } from "@workspace/integrations-openai-ai-server";

const chatModeChannels = new Set<string>();

const conversationHistory = new Map<string, Array<{ role: "user" | "assistant"; content: string }>>();

interface Warning {
  reason: string;
  moderator: string;
  timestamp: number;
}

const warnings = new Map<string, Map<string, Warning[]>>();

function getUserWarnings(guildId: string, userId: string): Warning[] {
  if (!warnings.has(guildId)) warnings.set(guildId, new Map());
  const guildWarns = warnings.get(guildId)!;
  if (!guildWarns.has(userId)) guildWarns.set(userId, []);
  return guildWarns.get(userId)!;
}

function addWarning(guildId: string, userId: string, warn: Warning) {
  const list = getUserWarnings(guildId, userId);
  list.push(warn);
}

function clearWarnings(guildId: string, userId: string) {
  warnings.get(guildId)?.set(userId, []);
}

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

  new SlashCommandBuilder()
    .setName("chat")
    .setDescription("Включить или выключить режим общения с ИИ в этом канале")
    .addSubcommand((sub) =>
      sub.setName("on").setDescription("Включить режим чата с ИИ")
    )
    .addSubcommand((sub) =>
      sub.setName("off").setDescription("Выключить режим чата с ИИ")
    ),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Выдать предупреждение пользователю")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) =>
      opt.setName("пользователь").setDescription("Кому выдать варн").setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName("причина").setDescription("Причина предупреждения").setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName("warnings")
    .setDescription("Посмотреть предупреждения пользователя")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) =>
      opt.setName("пользователь").setDescription("Чьи варны посмотреть").setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName("clearwarns")
    .setDescription("Сбросить все предупреждения пользователя")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((opt) =>
      opt.setName("пользователь").setDescription("У кого сбросить варны").setRequired(true)
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

  if (interaction.guild && interaction.user.id !== interaction.guild.ownerId && commandName !== "ask") {
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle("🚫 Нет доступа")
          .setDescription("Эти команды доступны только **создателю сервера**."),
      ],
      ephemeral: true,
    });
    return;
  }

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
              { name: "/chat on", value: "Включить режим чата — бот будет отвечать на все сообщения в канале", inline: false },
              { name: "/chat off", value: "Выключить режим чата", inline: false },
              { name: "/warn <пользователь> [причина]", value: "Выдать предупреждение (требует право Moderate Members)", inline: false },
              { name: "/warnings <пользователь>", value: "Посмотреть все предупреждения пользователя", inline: false },
              { name: "/clearwarns <пользователь>", value: "Сбросить все предупреждения пользователя", inline: false },
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

    else if (commandName === "chat") {
      const sub = interaction.options.getSubcommand();
      const channelId = interaction.channelId;

      if (sub === "on") {
        chatModeChannels.add(channelId);
        if (!conversationHistory.has(channelId)) {
          conversationHistory.set(channelId, []);
        }
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle("💬 Режим чата включён")
              .setDescription(
                "Теперь я буду отвечать на **каждое сообщение** в этом канале.\nЧтобы выключить — используй `/chat off`."
              ),
          ],
        });
      } else if (sub === "off") {
        chatModeChannels.delete(channelId);
        conversationHistory.delete(channelId);
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0xed4245)
              .setTitle("💬 Режим чата выключен")
              .setDescription("Я больше не буду отвечать на обычные сообщения в этом канале."),
          ],
        });
      }
    }

    else if (commandName === "warn") {
      const target = interaction.options.getMember("пользователь") as GuildMember | null;
      const reason = interaction.options.getString("причина") ?? "Причина не указана";

      if (!target) {
        await interaction.reply({ content: "❌ Пользователь не найден.", ephemeral: true });
        return;
      }

      if (target.user.bot) {
        await interaction.reply({ content: "❌ Нельзя предупреждать ботов.", ephemeral: true });
        return;
      }

      addWarning(interaction.guildId!, target.id, {
        reason,
        moderator: interaction.user.tag,
        timestamp: Date.now(),
      });

      const warnCount = getUserWarnings(interaction.guildId!, target.id).length;

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0xffa500)
            .setTitle("⚠️ Предупреждение выдано")
            .addFields(
              { name: "Пользователь", value: `${target.user.tag}`, inline: true },
              { name: "Предупреждений всего", value: `${warnCount}`, inline: true },
              { name: "Причина", value: reason, inline: false },
              { name: "Модератор", value: interaction.user.tag, inline: true },
            )
            .setTimestamp(),
        ],
      });

      try {
        await target.send({
          embeds: [
            new EmbedBuilder()
              .setColor(0xffa500)
              .setTitle(`⚠️ Ты получил предупреждение на сервере ${interaction.guild!.name}`)
              .addFields(
                { name: "Причина", value: reason },
                { name: "Предупреждений всего", value: `${warnCount}` },
              )
              .setTimestamp(),
          ],
        });
      } catch {
        // DM отключены — ничего страшного
      }
    }

    else if (commandName === "warnings") {
      const target = interaction.options.getUser("пользователь", true);
      const warnList = getUserWarnings(interaction.guildId!, target.id);

      if (warnList.length === 0) {
        await interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setColor(0x57f287)
              .setTitle("✅ Предупреждений нет")
              .setDescription(`У ${target.tag} нет ни одного предупреждения.`),
          ],
        });
        return;
      }

      const lines = warnList.map((w, i) => {
        const date = new Date(w.timestamp).toLocaleString("ru-RU");
        return `**${i + 1}.** ${w.reason}\n_ Выдал:_ ${w.moderator} • ${date}`;
      });

      const embed = new EmbedBuilder()
        .setColor(0xffa500)
        .setTitle(`⚠️ Предупреждения: ${target.tag}`)
        .setDescription(lines.join("\n\n").slice(0, 4000))
        .setFooter({ text: `Всего предупреждений: ${warnList.length}` })
        .setTimestamp();

      await interaction.reply({ embeds: [embed] });
    }

    else if (commandName === "clearwarns") {
      const target = interaction.options.getUser("пользователь", true);
      const before = getUserWarnings(interaction.guildId!, target.id).length;
      clearWarnings(interaction.guildId!, target.id);

      await interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(0x57f287)
            .setTitle("🗑️ Предупреждения сброшены")
            .setDescription(`Удалено **${before}** предупреждений у ${target.tag}.`),
        ],
      });
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

client.on("messageCreate", async (message: Message) => {
  if (message.author.bot) return;
  if (!chatModeChannels.has(message.channelId)) return;
  if (!message.content.trim()) return;

  try {
    await message.channel.sendTyping();

    const history = conversationHistory.get(message.channelId) ?? [];

    history.push({ role: "user", content: `${message.author.displayName}: ${message.content}` });

    if (history.length > 40) {
      history.splice(0, history.length - 40);
    }

    const response = await openai.chat.completions.create({
      model: "gpt-5.2",
      max_completion_tokens: 8192,
      messages: [
        {
          role: "system",
          content:
            "Ты дружелюбный и остроумный ИИ-ассистент в Discord. Общаешься непринуждённо и весело, как хороший друг. Используй Discord Markdown. Отвечай кратко — не более 3-4 предложений, если не просят подробнее. Не повторяй имя пользователя в каждом ответе.",
        },
        ...history,
      ],
    });

    const reply = response.choices[0]?.message?.content ?? "Не могу ответить прямо сейчас.";

    history.push({ role: "assistant", content: reply });
    conversationHistory.set(message.channelId, history);

    const truncated = reply.length > 2000 ? reply.slice(0, 1997) + "..." : reply;
    await message.reply(truncated);
  } catch (err) {
    logger.error({ err }, "Error in chat mode response");
  }
});

export async function startBot() {
  await client.login(token);
}
