/**
 * 自身のエリア情報文字列(`Radiko.getMyAreaId()`の戻り値、`'JP13/AreaFree'`形式)と
 * 局一覧に実際に含まれる全エリアIDから、番組表取得対象のエリアID配列を決定する。
 * エリアフリー会員なら全国47エリア、そうでなければ局一覧に実際に含まれる全エリア
 * (関東圏の他エリア局などを含む、BAYFM78/NACK5/YFMのような局の番組情報欠落を防ぐため)、
 * それも空なら自エリア+JP13にフォールバックする。
 * @param myAreaId `Radiko.getMyAreaId()`の戻り値(`'JP13/AreaFree'`形式)。未初期化の場合はundefined。
 * @param stationAreaIds 局一覧に実際に含まれる全エリアIDの一覧。
 * @returns 番組表取得対象とすべきエリアIDの配列。
 */
export function resolveAreaIdArray(myAreaId: string | undefined, stationAreaIds: readonly string[]): string[] {
  let ids: string[];
  if (myAreaId !== undefined) {
    ids = myAreaId.split('/');
  } else {
    ids = [];
  }

  if (ids[1] === 'AreaFree') {
    return Array.from({ length: 47 }, (_, i) => `JP${i + 1}`);
  }
  if (stationAreaIds.length > 0) {
    return [...stationAreaIds];
  }
  return [ids[0], 'JP13'];
}
