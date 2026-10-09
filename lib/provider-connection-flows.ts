import { getDb } from "@/lib/db";
import { createId } from "@/lib/ids";
import type { ProviderKind } from "@/lib/provider-catalog";

export type ProviderConnectionFlowStatus =
  | "pending"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

export type ProviderConnectionFlowRow = {
  id: string;
  user_id: string;
  profile_id: string;
  provider_kind: string;
  state_json: string;
  expires_at: string;
  consumed_at: string | null;
  status: ProviderConnectionFlowStatus;
  created_at: string;
};

export function insertProviderConnectionFlow(input: {
  userId: string;
  profileId: string;
  providerKind: ProviderKind;
  state: Record<string, unknown>;
  createdAt: Date;
  expiresAt: Date;
}) {
  const flowId = createId("provider_connection_flow");
  getDb()
    .prepare(
      `INSERT INTO provider_connection_flows (
        id, user_id, profile_id, provider_kind, state_json,
        expires_at, consumed_at, status, created_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'pending', ?)`
    )
    .run(
      flowId,
      input.userId,
      input.profileId,
      input.providerKind,
      JSON.stringify(input.state),
      input.expiresAt.toISOString(),
      input.createdAt.toISOString()
    );
  return flowId;
}

export function getProviderConnectionFlowRow(flowId: string) {
  return getDb()
    .prepare(
      `SELECT id, user_id, profile_id, provider_kind, state_json,
        expires_at, consumed_at, status, created_at
       FROM provider_connection_flows
       WHERE id = ?`
    )
    .get(flowId) as ProviderConnectionFlowRow | undefined;
}

export function getProviderConnectionFlow(flowId: string, userId: string) {
  const flow = getProviderConnectionFlowRow(flowId);
  if (!flow || flow.user_id !== userId) return null;
  return {
    id: flow.id,
    profileId: flow.profile_id,
    expiresAt: flow.expires_at,
    status: flow.status,
    createdAt: flow.created_at
  };
}

export function cancelProviderConnectionFlow(flowId: string, userId: string) {
  const result = getDb()
    .prepare(
      `UPDATE provider_connection_flows
       SET consumed_at = ?, status = 'canceled'
       WHERE id = ? AND user_id = ? AND consumed_at IS NULL AND status = 'pending'`
    )
    .run(new Date().toISOString(), flowId, userId);
  return result.changes === 1;
}

export function setProviderConnectionFlowStatus(flowId: string, status: ProviderConnectionFlowStatus) {
  getDb()
    .prepare("UPDATE provider_connection_flows SET status = ? WHERE id = ?")
    .run(status, flowId);
}

export function claimProviderConnectionFlow(input: {
  flowId: string;
  userId: string;
  profileId: string;
  profileNonce: string;
}) {
  const now = new Date().toISOString();
  const result = getDb()
    .prepare(
      `UPDATE provider_connection_flows
       SET consumed_at = ?, status = 'processing'
       WHERE id = ?
         AND user_id = ?
         AND profile_id = ?
         AND json_extract(state_json, '$.profileNonce') = ?
         AND consumed_at IS NULL
         AND status = 'pending'
         AND expires_at > ?
         AND EXISTS (
           SELECT 1 FROM users
           WHERE users.id = provider_connection_flows.user_id
             AND users.role = 'admin'
         )
         AND EXISTS (
           SELECT 1
           FROM provider_profile_connections
           JOIN provider_profiles
             ON provider_profiles.id = provider_profile_connections.profile_id
           WHERE provider_profile_connections.profile_id = provider_connection_flows.profile_id
             AND provider_profiles.provider_kind = provider_connection_flows.provider_kind
             AND provider_profile_connections.oauth_nonce = json_extract(provider_connection_flows.state_json, '$.profileNonce')
         )`
    )
    .run(
      now,
      input.flowId,
      input.userId,
      input.profileId,
      input.profileNonce,
      now
    );
  return result.changes === 1;
}
