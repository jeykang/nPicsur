import { TrackingState } from 'picsur-shared/dist/dto/tracking-state.enum';

export class ServerInfo {
  production = false;
  demo = false;
  version = '0.0.0';
  host_override?: string;
  tracking: {
    state: TrackingState;
    id?: string;
  } = {
    state: TrackingState.Disabled,
  };
  // How users can log in. Info saved by older versions does not have it.
  login?: {
    password: boolean;
    oidc: {
      name: string;
      auto_launch: boolean;
    } | null;
  } = { password: true, oidc: null };
}
