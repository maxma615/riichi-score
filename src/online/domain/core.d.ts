// Narrow declarations for the pinned 1.4.1 adapter boundary. Private engine
// state remains server-only; never serialize a Game to a browser.
declare module "@kobalab/majiang-core" {
  type Rule = Record<string, unknown>;
  class Shoupai {
    constructor(tiles?: string[]);
    static fromString(value: string): Shoupai;
    _zimo: string | null;
    _bingpai: Record<string, number[]>;
    readonly menqian: boolean;
    _fulou: string[];
    lizhi: boolean;
    toString(): string;
    clone(): Shoupai;
    zimo(tile: string): Shoupai;
    dapai(tile: string): Shoupai;
    fulou(meld: string): Shoupai;
    gang(meld: string): Shoupai;
    get_dapai(check?: boolean): string[] | null;
    get_peng_mianzi(tile: string): string[] | null;
    get_gang_mianzi(tile?: string): string[] | null;
  }
  class Shan {
    static zhenbaopai(tile: string): string;
    constructor(rule: Rule);
    _pai: string[];
    _baopai: string[];
    _fubaopai: string[] | null;
    _weikaigang: boolean;
    _closed: boolean;
    paishu: number;
    baopai: string[];
    zimo(): string;
  }
  type Reply = { dapai?: string; fulou?: string; gang?: string; hule?: boolean; daopai?: boolean };
  type Model = { player: string[]; qijia: number; zhuangfeng: number; jushu: number; changbang: number; lizhibang: number; defen: number[]; shan: Shan; shoupai: Shoupai[]; he: { _pai: string[] }[]; player_id: number[]; lunban: number };
  class Game {
    constructor(players: unknown[], callback?: (() => void) | null, rule?: Rule, title?: string);
    _model: Model;
    _rule: Rule;
    _status: string;
    _reply: Reply[];
    _sync: boolean;
    _gang: string | null;
    _dapai: string | null;
    _hule_option: string | null;
    _paipu: { rank: number[] };
    _diyizimo: boolean;
    _lizhi: (0 | 1 | 2)[];
    _neng_rong: boolean[];
    _fenpei: number[];
    delay(callback: () => void, timeout?: number): void;
    notify_players(type: string, messages: unknown[]): void;
    call_players(type: string, messages: unknown[], timeout?: number): void;
    qipai(shan?: Shan): void;
    kaiju(qijia?: number): void;
    next(): void;
    get_dapai(): string[];
    get_chi_mianzi(wind: number): string[] | null;
    get_peng_mianzi(wind: number): string[] | null;
    get_gang_mianzi(wind?: number): string[] | null;
    allow_lizhi(tile?: string): boolean | string[];
    allow_hule(wind?: number): boolean;
    allow_pingju(): boolean;
  }
  type HuleResult = { hupai?: { name: string; fanshu: number | string; baojia?: string }[]; fu?: number; fanshu?: number; damanguan?: number; defen: number };
  type HuleOptions = { rule?: Rule; zhuangfeng?: number; menfeng?: number; lizhi?: number; yifa?: boolean; qianggang?: boolean; lingshang?: boolean; haidi?: number; tianhu?: number; baopai?: string[]; fubaopai?: string[] };
  type Util = { xiangting(hand: Shoupai): number; xiangting_guoshi(hand: Shoupai): number; tingpai(hand: Shoupai): string[] | null; hule_param(options?: HuleOptions): unknown; hule(hand: Shoupai, ron: string | null, params: unknown): HuleResult | undefined };
  const Majiang: { Game: typeof Game; Shan: typeof Shan; Shoupai: typeof Shoupai; Util: Util; rule(values?: Rule): Rule };
  export default Majiang;
}
