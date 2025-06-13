export interface BrowseItem {
    service: string;
    type: string;
    title: string;
    albumart?: string;
    uri: string;
    artist?: string;
    album?: string;
    samplerate?: string;
    bitdepth?: number;
    channels?: number;
}
export interface BrowseList {
    title: string;
    availableListViews: string[];
    items: BrowseItem[];
}
export interface BrowseNavigation {
    lists: BrowseList[];
    prev?: {
        uri: string;
    };
}
export interface BrowseResult {
    navigation: BrowseNavigation;
    uri: string;
}
//# sourceMappingURL=BrowseResultModel.d.ts.map