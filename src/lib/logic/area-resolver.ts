/**
 * 自身のエリア情報文字列(`Radiko.getMyAreaId()`の戻り値、`'JP13/AreaFree'`形式)と
 * 局一覧に実際に含まれる全エリアIDから、番組表取得対象のエリアID配列を決定する。
 * エリアフリー会員は、設定画面(`radikoAreas`)でエリアを選択していればそのエリアのみ、
 * 未選択(空配列)なら全国47エリア。エリアフリーでなければ局一覧に実際に含まれる全エリア
 * (関東圏の他エリア局などを含む、BAYFM78/NACK5/YFMのような局の番組情報欠落を防ぐため)、
 * それも空なら自エリア+JP13にフォールバックする。
 * @param myAreaId `Radiko.getMyAreaId()`の戻り値(`'JP13/AreaFree'`形式)。未初期化の場合はundefined。
 * @param stationAreaIdArray 局一覧に実際に含まれる全エリアIDの一覧。
 * @param selectedAreaIdArray エリアフリー会員が設定画面で選択したエリアIDの一覧。未指定/空なら全国47エリアを対象にする。
 * @returns 番組表取得対象とすべきエリアIDの配列。
 */
export function resolveAreaIdArray(myAreaId: string | undefined, stationAreaIdArray: readonly string[], selectedAreaIdArray: readonly string[] = []): string[] {
  let idArray: string[];
  if (myAreaId !== undefined) {
    idArray = myAreaId.split('/');
  } else {
    idArray = [];
  }

  if (idArray[1] === 'AreaFree') {
    if (selectedAreaIdArray.length > 0) {
      return [...selectedAreaIdArray];
    }
    return Array.from({ length: 47 }, (_, i) => `JP${i + 1}`);
  }
  if (stationAreaIdArray.length > 0) {
    return [...stationAreaIdArray];
  }
  return [idArray[0], 'JP13'];
}
