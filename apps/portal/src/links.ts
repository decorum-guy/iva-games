import { gameRegistry } from '@iva-games/game-registry';

// The standalone dev portal retains its local collection route. Production
// uses the chess collection host, while the old /chess URL remains readable.
export const chessHomeUrl = import.meta.env.DEV ? '/chess' : `${gameRegistry.chessOrigin}/`;
