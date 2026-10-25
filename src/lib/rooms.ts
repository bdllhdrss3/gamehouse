import { io, type Socket } from 'socket.io-client';
import { roomSchema, type Command, type Room, type RoomReply } from '../../shared/protocol';
import type { AvatarId, ChessPieceId, Preset } from '../../shared/game';
import { newId } from './id';

export type RoomCommand = Command extends infer T ? T extends Command ? Omit<T, 'requestId' | 'revision'> : never : never;
export class RoomConnection {
  private socket: Socket | null = null;
  you = '';
  onRoom: (room: Room) => void = () => {};
  onStatus: (connected: boolean) => void = () => {};
  onError: (message: string) => void = () => {};
  private invitation = '';
  private profile: { name: string; avatar: AvatarId; piece: ChessPieceId } | null = null;

  async connect() {
    if (this.socket) return;
    const response = await fetch('/api/session', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Friend rooms are unavailable. Please try again shortly.');
    const session: { you: string } = await response.json();
    this.you = session.you;
    const socket = io({ autoConnect: false, withCredentials: true });
    this.socket = socket;
    socket.on('room', (payload: unknown) => {
      const parsed = roomSchema.safeParse(payload);
      if (parsed.success) this.onRoom(parsed.data);
      else {
        console.error('Incompatible room snapshot.', parsed.error);
        this.onError('Your room data is incompatible. Refresh the app before continuing.');
      }
    });
    socket.on('disconnect', () => this.onStatus(false));
    socket.on('connect_error', (error: Error) => {
      this.onStatus(false);
      this.onError(`Cannot reach your room: ${error.message}`);
    });
    socket.on('connect', () => {
      this.onStatus(true);
      if (this.invitation && this.profile) {
        void this.join(this.invitation, this.profile).catch(error => this.onError(error instanceof Error ? error.message : 'Could not restore your seat.'));
      }
    });
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => { cleanup(); reject(new Error('The room server did not respond. Try again when connected.')); }, 10000);
      const cleanup = () => { clearTimeout(timer); socket.off('connect', success); socket.off('connect_error', failure); };
      const success = () => { cleanup(); resolve(); };
      const failure = (error: Error) => { cleanup(); reject(error); };
      socket.once('connect', success);
      socket.once('connect_error', failure);
      socket.connect();
    });
  }
  private async request(event: string, payload: unknown): Promise<Room> {
    if (!this.socket?.connected) throw new Error('You are disconnected. Reconnect before taking your turn.');
    const reply = await new Promise<RoomReply>((resolve, reject) => {
      this.socket!.timeout(8000).emit(event, payload, (error: Error | null, value: RoomReply) => {
        if (error) reject(new Error('No acknowledgement received. Reconnect to check the latest state before trying again.'));
        else resolve(value);
      });
    });
    if (!reply.ok) {
      if (reply.room) this.onRoom(roomSchema.parse(reply.room));
      throw new Error(reply.error);
    }
    this.you = reply.value.you;
    const room = roomSchema.parse(reply.value.room);
    this.onRoom(room);
    return room;
  }
  async create(preset: Preset, profile: { name: string; avatar: AvatarId; piece: ChessPieceId }, boardSeed = 0) {
    const room = await this.request('create', { protocol: 1, requestId: newId(), preset, boardSeed, ...profile });
    this.invitation = room.invite; this.profile = profile;
    return room;
  }
  async join(invitation: string, profile: { name: string; avatar: AvatarId; piece: ChessPieceId }) {
    const room = await this.request('join', { protocol: 1, invitation, ...profile });
    this.invitation = room.invite; this.profile = profile;
    return room;
  }
  async command(room: Room, command: RoomCommand) {
    return this.request('command', { roomId: room.id, requestId: newId(), revision: room.revision, ...command });
  }
  close() {
    this.invitation = ''; this.profile = null;
    this.socket?.disconnect(); this.socket?.removeAllListeners(); this.socket = null;
  }
}
