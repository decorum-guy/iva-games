/** Test-only saved-lobby setup. Never imported by the production server.
 * The HTTP server must be stopped while this helper owns its isolated databases.
 * This uses the preserved v0.3 registration to create a real durable lobby; the
 * current built server handles every invitation, setting, start and game action.
 */
import { DistrictRuntime } from '@iva-games/district/runtime';
import { TERRITORY_CONTENT, TERRITORY_RULES } from '@iva-games/district/territorial';
import { PlatformService } from '../apps/platform/src/service';

export const latestDistrictProfile = { rulesVersion: TERRITORY_RULES, contentVersion: TERRITORY_CONTENT };

export async function createSavedLegacyLobby(options: {
  databasePath: string;
  runtimeDatabasePath: string;
  publicOrigin: string;
  playerId: string;
  title: string;
  capacity: number;
  mapId: string;
}) {
  const district = new DistrictRuntime({ databasePath: options.runtimeDatabasePath });
  let platform: PlatformService | undefined;
  try {
    platform = new PlatformService({ databasePath: options.databasePath, publicOrigin: options.publicOrigin,
      games: [district.registration()] });
    await platform.ready;
    return platform.createRoom(options.playerId, { gameId: 'district', title: options.title,
      capacity: options.capacity, settings: { mapId: options.mapId, mapVersion: '1' } });
  } finally {
    platform?.stopReconciliation();
    try { await platform?.settle(); }
    finally {
      platform?.close();
      district.close();
    }
  }
}
