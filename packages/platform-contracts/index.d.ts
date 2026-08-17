export interface TuxDesktopApi {
  readonly app: {
    readonly getVersion: () => Promise<string>;
  };
}
