export interface RadikoXMLData {
  radiko: {
    stations: {
      station: RadikoXMLStation[];
    };
  };
}

export interface RadikoXMLStation {
  // station id
  '@id': string;
  progs: {
    prog: {
      '@id': string;
      '@ft': string;
      '@to': string;
      title: string;
      pfm?: string;
      img: string;
    }[];
  };
}
