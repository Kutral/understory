import type { FloraProvider, TreePlacement } from '@contracts/flora';
import type { ChunkKey } from '@contracts/world';

/** flora agent (G) owns. Stub: no trees yet. */
export class StubFlora implements FloraProvider {
  treesFor(_key: ChunkKey): TreePlacement[] {
    return [];
  }

  undergrowthFor(_key: ChunkKey): TreePlacement[] {
    return [];
  }
}
