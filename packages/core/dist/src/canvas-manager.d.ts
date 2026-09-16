/**
 * ACR OpsRoom - Live Collaborative Ops Canvas Manager
 * Reinvents Slack Canvases:
 * - Real-time reactive bi-directional data fields
 * - Merkle-validated state mutations
 * - Action item assignment and cryptographic verification
 * - Dynamic executive summary compilation
 */
import { OpsCanvas, CanvasActionItem } from './types.js';
export declare class OpsCanvasManager {
    /**
     * Update live telemetry and infrastructure fields on the canvas.
     */
    static updateLiveFields(canvas: OpsCanvas, partialFields: Partial<OpsCanvas['liveFields']>): OpsCanvas;
    /**
     * Add or update an action item on the canvas.
     */
    static upsertActionItem(canvas: OpsCanvas, item: Omit<CanvasActionItem, 'id'> & {
        id?: string;
    }): CanvasActionItem;
    /**
     * Append Markdown section to the canvas report.
     */
    static appendMarkdown(canvas: OpsCanvas, section: string): void;
    /**
     * Compute and assign SHA-256 Merkle root hash of current canvas state.
     */
    static refreshMerkleRoot(canvas: OpsCanvas): string;
}
//# sourceMappingURL=canvas-manager.d.ts.map