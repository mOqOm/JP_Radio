export interface RadikoXMLData {
  radiko: {
    stations: {
      station: RadikoXMLStation[];
    };
  };
}

export interface RadikoXMLStation {
  '@id': string;  // station id
  progs: {
    date: string;
    prog: {
      '@id': string;  // prog id
      '@ft': string;
      '@to': string;
      title: string;
      info : string;
      pfm  : string;
      img  : string;
    }[];
  }[];
}
