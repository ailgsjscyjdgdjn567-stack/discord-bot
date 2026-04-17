import {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
} from "@discordjs/voice";
import play from "play-dl";
import { VoiceBasedChannel } from "discord.js";
import { logger } from "../lib/logger";

const FUN_SONGS: Array<{ query: string; label: string }> = [
  { query: "never gonna give you up rick astley", label: "🎵 Never Gonna Give You Up (Rickroll)" },
  { query: "nyan cat original", label: "🐱 Nyan Cat" },
  { query: "coffin dance astronomia bass boosted", label: "⚰️ Astronomia (Coffin Dance)" },
  { query: "darude sandstorm", label: "🎹 Darude — Sandstorm" },
  { query: "soviet anthem red army choir", label: "🎖️ Soviet Anthem" },
  { query: "careless whisper george michael", label: "🎷 Careless Whisper" },
  { query: "gangnam style psy", label: "🕺 Gangnam Style" },
  { query: "take on me a-ha", label: "🎵 Take On Me" },
];

const activeSessions = new Map<string, boolean>();
let scReady = false;

async function ensureSoundCloud() {
  if (scReady) return;
  try {
    const id = await play.getFreeClientID();
    await play.setToken({ soundcloud: { client_id: id } });
    scReady = true;
    logger.info("SoundCloud client ID obtained");
  } catch (err) {
    logger.warn({ err }, "Could not get SoundCloud client ID, will fallback");
  }
}

export async function playSecretSong(
  voiceChannel: VoiceBasedChannel
): Promise<{ label: string } | { error: string }> {
  const guildId = voiceChannel.guild.id;

  if (activeSessions.get(guildId)) {
    return { error: "Секрет уже воспроизводится! Подождите пока трек закончится." };
  }

  await ensureSoundCloud();

  const picked = FUN_SONGS[Math.floor(Math.random() * FUN_SONGS.length)]!;

  try {
    const results = await play.search(picked.query, {
      limit: 1,
      source: { soundcloud: "tracks" },
    });

    if (!results.length || !results[0]) {
      return { error: "Не удалось найти трек. Попробуй ещё раз!" };
    }

    const trackUrl = results[0].url;
    if (!trackUrl) return { error: "Не удалось получить URL трека." };

    const stream = await play.stream(trackUrl);
    const resource = createAudioResource(stream.stream, { inputType: stream.type });

    const player = createAudioPlayer({
      behaviors: { noSubscriber: NoSubscriberBehavior.Pause },
    });

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId,
      adapterCreator: voiceChannel.guild.voiceAdapterCreator,
    });

    connection.subscribe(player);
    player.play(resource);
    activeSessions.set(guildId, true);

    const cleanup = () => {
      activeSessions.delete(guildId);
      try { connection.destroy(); } catch { /* ignore */ }
    };

    player.on(AudioPlayerStatus.Idle, cleanup);
    player.on("error", (err) => {
      logger.error({ err }, "Secret player error");
      cleanup();
    });

    return { label: picked.label };
  } catch (err) {
    activeSessions.delete(guildId);
    logger.error({ err }, "Failed to play secret song");
    return { error: "Не удалось запустить музыку. Попробуй ещё раз через несколько секунд!" };
  }
}
