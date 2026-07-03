import type { ChatInputCommandInteraction } from 'discord.js';

// A slash command: a builder (any of discord.js's builder variants all expose
// `name` + `toJSON()`) and an execute handler.
export interface Command {
  data: { name: string; toJSON(): unknown };
  execute(interaction: ChatInputCommandInteraction): Promise<void>;
}
