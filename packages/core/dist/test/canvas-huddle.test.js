import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { OpsCanvasManager } from '../src/canvas-manager.js';
import { HuddleManager } from '../src/huddle-manager.js';
import { Atlas2Engine } from '../src/atlas-engine.js';
import { MLIncidentRouter } from '../src/ml-router.js';
describe('OpsCanvasManager & HuddleManager', () => {
    const squad = MLIncidentRouter.createDefaultSquad('squad-sre-core');
    test('updates live fields and re-computes Merkle root', () => {
        const incident = Atlas2Engine.createIncident('Canvas Test', 'Testing live fields', squad);
        const canvas = incident.canvas;
        const initialRoot = canvas.auditMerkleRoot;
        OpsCanvasManager.updateLiveFields(canvas, {
            trafficImpactPercent: 35.2,
            errorRateSpike: 12.4,
        });
        assert.equal(canvas.liveFields.trafficImpactPercent, 35.2);
        assert.equal(canvas.liveFields.errorRateSpike, 12.4);
        assert.notEqual(canvas.auditMerkleRoot, initialRoot);
    });
    test('upserts action items with state tracking', () => {
        const incident = Atlas2Engine.createIncident('Action Items Test', 'Testing action items', squad);
        const canvas = incident.canvas;
        const item = OpsCanvasManager.upsertActionItem(canvas, {
            title: 'Deploy rate limiter on /api/v1/auth',
            assignedToRole: 'secops_guardian',
            status: 'in_progress',
            priority: 'p0',
        });
        assert.ok(item.id.startsWith('action-'));
        assert.equal(canvas.actionItems.some(a => a.title === 'Deploy rate limiter on /api/v1/auth'), true);
        // Update status to verified
        OpsCanvasManager.upsertActionItem(canvas, {
            id: item.id,
            title: item.title,
            assignedToRole: item.assignedToRole,
            status: 'verified',
            priority: 'p0',
        });
        const updated = canvas.actionItems.find(a => a.id === item.id);
        assert.equal(updated?.status, 'verified');
    });
    test('runs synthetic huddle and syncs executive brief to canvas', () => {
        const incident = Atlas2Engine.createIncident('Huddle Test', 'Deliberation test', squad);
        const huddle = HuddleManager.startHuddle(incident.id, squad.agents);
        assert.equal(huddle.status, 'active');
        assert.equal(huddle.participants.length, 5);
        HuddleManager.addSpokenLine(huddle, squad.agents[1], 'Telemetry indicates 503 errors originating from upstream proxy timeout.');
        HuddleManager.addSpokenLine(huddle, squad.agents[2], 'Confirmed no credential exfiltration; safe to execute proxy keepalive patch.');
        assert.equal(huddle.lines.length, 2);
        assert.equal(huddle.lines[0].audioFrequencyData?.length, 16);
        const { brief, newActionItems } = HuddleManager.synthesizeAndSyncToCanvas(huddle, incident.canvas);
        assert.ok(brief.length > 20);
        assert.ok(newActionItems.length > 0);
        assert.equal(huddle.status, 'summarized');
        assert.ok(incident.canvas.summaryMarkdown.includes('Synthetic Huddle Executive Brief'));
    });
});
//# sourceMappingURL=canvas-huddle.test.js.map