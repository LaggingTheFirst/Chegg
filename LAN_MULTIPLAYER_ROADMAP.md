# Chegg LAN Multiplayer Roadmap (Online + Spectator Removed)

This roadmap replaces the previous online-focused plan with a LAN-only architecture.

Scope decisions:
- Keep local multiplayer and AI.
- Add LAN host/join multiplayer.
- Remove online matchmaking, account/ELO, and spectator mode.
- Do not add cloud services right now.

## 1. Current System Audit (What To Reuse)

Reliable systems to reuse:
- `js/engine/GameState.js`
- `js/engine/TurnManager.js`
- `js/engine/DeckManager.js`
- `js/engine/Board.js`
- `js/minions/AbilitySystem.js`
- `js/ui/BoardUI.js`
- `js/ui/HandUI.js`
- `js/ui/InfoPanel.js`
- `js/mods/ModManager.js`
- `js/ui/ModManagerUI.js`

Existing multiplayer/server code currently tied to online flow:
- `js/multiplayer/NetworkClient.js` (auth + matchmaking + custom rooms + spectate)
- `js/multiplayer/AuthManager.js`
- `server/index.js`
- `server/RoomManager.js`
- `server/Room.js`

## 2. Hard De-scope (Online + Spectator)

Remove or disable these paths first to avoid mixed behavior:

Frontend (`js/main.js`)
- Remove `Find Online Match` and `Custom Online Game` menu actions (`js/main.js:87`, `js/main.js:114`, `js/main.js:146`, `js/main.js:154`).
- Remove room list spectate UI button (`js/main.js:270`).
- Remove `startMatchmaking`, `showCustomOnlineMenu`, `joinRoom`, `spectateRoom`, `showProfileModal`, `showRatingChange`, `isSpectator` (`js/main.js:209`, `js/main.js:293`, `js/main.js:301`, `js/main.js:1071`, `js/main.js:1143`, `js/main.js:1198`, `js/main.js:1272`).
- Keep `onServerStateUpdate` idea but rename for LAN client flow (`js/main.js:1085`).

Client networking (`js/multiplayer`)
- Replace `NetworkClient` online protocol with LAN protocol.
- Delete `AuthManager` usage and rank/auth event handling.

Server (`server/*`)
- Remove `join_matchmaking` event handling (`server/index.js:38`, `server/RoomManager.js:9`).
- Remove custom-room online listing endpoints if LAN lobby replaces them (`server/index.js:44-54`, `server/RoomManager.js:33`, `server/RoomManager.js:100`).
- Remove spectator support (`server/index.js:50`, `server/RoomManager.js:125`, `server/Room.js:21`, `server/Room.js:46-47`, `server/Room.js:460-463`, `server/Room.js:473`).
- Remove ELO/account persistence if no online identity (`server/RoomManager.js:57`, `server/Room.js:383`, `server/Room.js:416`).

## 3. LAN Architecture (Authoritative Host)

Design rules:
- Host is authoritative.
- Clients send intent actions only.
- Host validates with engine logic and broadcasts results.
- No direct client-side state mutation in LAN mode.

### 3.1 New multiplayer modules

Add:
- `js/multiplayer/LanClient.js`
- `js/multiplayer/LanProtocol.js`
- `js/multiplayer/LanDiscovery.js`

If you keep a JS server for dev builds, add:
- `server/LanHost.js` (or adapt `server/Room.js` into LAN-only room runtime)

Protocol actions (minimum):
- `SPAWN_MINION`
- `MOVE_MINION`
- `ATTACK_MINION`
- `USE_ABILITY`
- `END_TURN`

Transport events (minimum):
- `hello`
- `lobby_state`
- `match_start`
- `action_result`
- `state_snapshot` (resync/rejoin only)
- `timer_tick` (optional)
- `error`

### 3.2 Sync model

Primary sync:
- Action-based replication from host.

Recovery sync:
- End of each turn, send `state_hash`.
- If mismatch detected, request `state_snapshot` from host.
- On reconnect, always request snapshot then resume action stream.

## 4. UI Integration Plan (LAN-Only)

Update start screen in `js/main.js`:
- Replace online buttons with:
- `Host LAN Game`
- `Join LAN Game`

Add LAN screens:
- Host setup modal (port, player name, deck select).
- Join modal (auto-discovered hosts + manual IP:port fallback).
- LAN lobby (connected players, ready state, mod compatibility, start button for host).

Reuse existing in-game UI:
- `BoardUI`, `HandUI`, `InfoPanel` unchanged where possible.
- Keep `playerColor` restrictions for turn ownership, but remove spectator branch checks.

## 5. Mod Compatibility for LAN

Rules:
- Mods cannot mutate authoritative state outside event pipeline.
- Every gameplay effect must be represented as a network action/event.

Join handshake:
- Exchange:
- Engine version
- Active mod IDs
- Mod checksums

Policy:
- Block match start on mismatch (do not allow partial mismatch mode).

Files to implement:
- Extend `js/mods/ModManager.js` with deterministic checksum export.
- Add compatibility UI in `js/ui/ModManagerUI.js` + LAN lobby modal.

## 6. Cross-Platform Packaging Without Piggybacking Node

Recommended path: Tauri (Rust backend + WebView frontend)

Why:
- No Node runtime required in production.
- Smaller binaries than Electron.
- Rust can own WebSocket + UDP discovery.

Suggested runtime split:
- Frontend JS: rendering, local input, UI state.
- Rust backend: LAN host socket server, LAN client transport, UDP/mDNS discovery, platform permissions.

Windows:
- Package with Tauri desktop target.

Android:
- Tauri mobile target.
- Add multicast/network permissions.
- Acquire multicast lock through plugin/native bridge when discovery starts.

Practical migration sequence:
1. Keep current JS frontend as-is.
2. Move LAN networking from JS/Node server into Rust commands/events.
3. Keep one shared wire protocol spec (`LanProtocol`) for both sides.
4. Build desktop first, then Android.

Alternative if you avoid Rust right now:
- Capacitor + native plugins for discovery/network.
- Still avoid Node server in shipped app by implementing host/client in native layer.

## 7. Incremental Delivery Plan

Phase A: LAN MVP (2 players)
- Host by IP:port (manual join).
- Authoritative action sync.
- No discovery yet.

Phase B: LAN discovery + lobby
- UDP/mDNS discovery list.
- Ready/start flow.
- Reconnect and resync path.

Phase C: Mod-safe LAN
- Version/checksum handshake.
- Hard block on mismatch.

Phase D: Packaging
- Tauri Windows build.
- Tauri Android build.
- Cross-platform LAN test matrix.

## 8. Test Matrix (LAN-Only)

Functional:
- Spawn/move/attack/ability/end-turn sync correctness.
- Turn ownership enforcement.
- Timer consistency if enabled.

Desync:
- Packet drop simulation.
- Delayed packet ordering.
- Mid-turn reconnect.

Compatibility:
- Mod mismatch block.
- Engine version mismatch block.

Cross-platform:
- Windows host -> Android join.
- Android host -> Windows join.
- Different routers/AP isolation edge case.

## 9. Concrete File Mapping Summary

Immediate cleanup targets:
- `js/main.js`
- `js/multiplayer/NetworkClient.js`
- `js/multiplayer/AuthManager.js`
- `server/index.js`
- `server/RoomManager.js`
- `server/Room.js`

New LAN targets:
- `js/multiplayer/LanClient.js`
- `js/multiplayer/LanDiscovery.js`
- `js/multiplayer/LanProtocol.js`
- `server/LanHost.js` (temporary dev host) OR Rust Tauri backend equivalent

Engine/UI/mod reuse targets:
- `js/engine/*` (core turn/state/deck/board systems)
- `js/minions/*`
- `js/ui/BoardUI.js`
- `js/ui/HandUI.js`
- `js/ui/InfoPanel.js`
- `js/mods/ModManager.js`
- `js/ui/ModManagerUI.js`

## 10. Guardrails To Prevent Regressions

- Keep one source of truth: host-applied actions only.
- No hidden side effects in mods.
- Full snapshot is fallback only, not primary sync.
- Remove spectator paths entirely instead of feature-flagging partially.
- Do not reintroduce online/account code until LAN stability passes QA.
