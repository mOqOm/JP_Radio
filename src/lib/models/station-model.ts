/** getStations()などで使う、XMLパース後の地域データ */
export interface RegionData {
  region_name: string;
  region_id: string;
  ascii_name: string;
  stations: Array<{
    id: string;
    name: string;
    ascii_name: string;
    areafree: string;
    timefree: string;
    banner: string;
    area_id: string;
  }>;
}

/** stations Map に格納する局データ */
export interface StationInfo {
  RegionName: string;
  BannerURL: string;
  AreaId: string;
  AreaName: string;
  AreaKanji : string;
  Name: string;
  AsciiName: string;
  AreaFree  : string;
}
