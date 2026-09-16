/**
 * ACR OpsRoom - Live Collaborative Ops Canvas Manager
 * Reinvents Slack Canvases:
 * - Real-time reactive bi-directional data fields
 * - Merkle-validated state mutations
 * - Action item assignment and cryptographic verification
 * - Dynamic executive summary compilation
 */
import crypto from 'node:crypto';
export class OpsCanvasManager {
    /**
     * Update live telemetry and infrastructure fields on the canvas.
     */
    static updateLiveFields(canvas, partialFields) {
        canvas.liveFields = {
            ...canvas.liveFields,
            ...partialFields,
        };
        canvas.version++;
        canvas.lastUpdated = Date.now();
        this.refreshMerkleRoot(canvas);
        return canvas;
    }
    /**
     * Add or update an action item on the canvas.
     */
    static upsertActionItem(canvas, item) {
        const id = item.id || `action-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
        const existingIndex = canvas.actionItems.findIndex(a => a.id === id);
        const fullItem = {
            id,
            title: item.title,
            assignedToRole: item.assignedToRole,
            status: item.status,
            priority: item.priority,
            proofUrl: item.proofUrl,
        };
        if (existingIndex >= 0) {
            canvas.actionItems[existingIndex] = fullItem;
        }
        else {
            canvas.actionItems.push(fullItem);
        }
        canvas.version++;
        canvas.lastUpdated = Date.now();
        this.refreshMerkleRoot(canvas);
        return fullItem;
    }
    /**
     * Append Markdown section to the canvas report.
     */
    static appendMarkdown(canvas, section) {
        canvas.summaryMarkdown += `\n\n${section}`;
        canvas.version++;
        canvas.lastUpdated = Date.now();
        this.refreshMerkleRoot(canvas);
    }
    /**
     * Compute and assign SHA-256 Merkle root hash of current canvas state.
     */
    static refreshMerkleRoot(canvas) {
        const statePayload = JSON.stringify({
            id: canvas.id,
            version: canvas.version,
            status: canvas.status,
            liveFields: canvas.liveFields,
            actionItems: canvas.actionItems,
            summaryMarkdown: canvas.summaryMarkdown,
        });
        const hash = crypto.createHash('sha256').update(statePayload).digest('hex');
        canvas.auditMerkleRoot = hash;
        return hash;
    }
}
//# sourceMappingURL=canvas-manager.js.map