import { PermissionFlagsBits, type ChatInputCommandInteraction } from 'discord.js';
import { config } from './config.js';

/** True if the invoking member has the configured admin role or Manage Guild. */
export function isAdmin(interaction: ChatInputCommandInteraction): boolean {
  if (!interaction.inCachedGuild()) return false;
  const member = interaction.member;
  if (config.adminRoleId && member.roles.cache.has(config.adminRoleId)) return true;
  return member.permissions.has(PermissionFlagsBits.ManageGuild);
}

/** True if the member has the given role (undefined roleId ⇒ no gate ⇒ true). */
export function hasRole(interaction: ChatInputCommandInteraction, roleId: string | undefined): boolean {
  if (!roleId) return true;
  if (!interaction.inCachedGuild()) return false;
  return interaction.member.roles.cache.has(roleId);
}
