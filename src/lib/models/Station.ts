export interface StationInfo {
  id: string;
  name: string;
  ascii_name: string;
  areafree?: string;
  timefree?: string;
  banner?: string;
  area_id: string;
}

export interface Region {
  region_id: string;
  region_name: string;
  [key: string]: any; // 必要に応じて型定義を拡張
}

export interface RegionData {
  region: Region;
  stations: StationInfo[];
}

export interface StationMapData {
  RegionName: string;
  BannerURL?: string;
  AreaID: string;
  AreaName: string;
  Name: string;
  AsciiName: string;
}
