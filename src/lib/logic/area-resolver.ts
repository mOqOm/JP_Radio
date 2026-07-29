/**
 * 自身のエリア情報文字列(`Radiko.getMyAreaId()`の戻り値、`'JP13/AreaFree'`形式)と
 * 局一覧に実際に含まれる全エリアIDから、番組表取得対象のエリアID配列を決定する。
 * 設定画面(`radikoAreas`)でエリアを選択していれば、原則としてそのエリア(+全国ネット局分の
 * 番組表取得に必要な`'JP13'`)だけを対象にする(選択エリア以外はBrowse表示自体が
 * {@link resolveAreaFilter}で絞り込まれ表示されなくなるため、番組表を取得する必要がない)。
 * ただし未ログイン時は局一覧自体が自エリアの局のみに制限され、選択エリアと無関係に自エリアの
 * 局しか存在しないため、自エリアの番組表が欠落しないよう自エリアのIDも対象に加える
 * (ログイン済みの場合は会員種別を問わず自エリアを強制的には含めない)。
 * 未選択(空配列)の場合、エリアフリー会員なら全国47エリア、それ以外は局一覧に実際に含まれる
 * 全エリア(関東圏の他エリア局などを含む、BAYFM78/NACK5/YFMのような局の番組情報欠落を防ぐため)、
 * それも空なら自エリア+JP13にフォールバックする。
 * @param myAreaId `Radiko.getMyAreaId()`の戻り値(`'JP13/AreaFree'`形式、未ログイン時は`'JP13/'`)。
 *   未初期化の場合はundefined。
 * @param stationAreaIdArray 局一覧に実際に含まれる全エリアIDの一覧。
 * @param selectedAreaIdArray 設定画面で選択したエリアIDの一覧。未指定/空なら未選択時の既定動作にフォールバックする。
 * @returns 番組表取得対象とすべきエリアIDの配列。
 */
export function resolveAreaIdArray(myAreaId: string | undefined, stationAreaIdArray: readonly string[], selectedAreaIdArray: readonly string[] = []): string[] {
  if (selectedAreaIdArray.length > 0) {
    const areaSet = new Set(selectedAreaIdArray);
    // 全国ネット局(regionName === '全国')の番組表は'JP13'取得時にしか含まれないため、常に加える
    areaSet.add('JP13');
    if (myAreaId !== undefined) {
      const [myArea, memberType] = myAreaId.split('/');
      if (memberType === '') {
        // 未ログイン時は局一覧が自エリアの局のみに制限されるため、自エリアも対象に加える
        areaSet.add(myArea);
      }
    }
    return [...areaSet];
  }

  let idArray: string[];
  if (myAreaId !== undefined) {
    idArray = myAreaId.split('/');
  } else {
    idArray = [];
  }

  if (idArray[1] === 'AreaFree') {
    return Array.from({ length: 47 }, (_, i) => `JP${i + 1}`);
  }
  if (stationAreaIdArray.length > 0) {
    return [...stationAreaIdArray];
  }
  return [idArray[0], 'JP13'];
}

/**
 * 局一覧のBrowse表示(ライブ/タイムフリー/検索)を「エリア選択」設定で絞り込むべきエリアID集合を返す。
 * 設定画面で1つ以上エリアを選択していれば会員種別によらず絞り込みを行い、未選択(空配列)ならnull
 * (絞り込みなし=全局対象)を返す。絞り込み適用時も、全国ネット局(regionName === '全国')は
 * エリアを問わず受信可能なため、呼び出し側でこの集合とは別に常に含めること
 * ({@link JpRadio.radioStations}などの`'全国'`除外ロジックを参照)。
 * @param selectedAreaIdArray 設定画面で選択したエリアIDの一覧。
 * @returns 絞り込み対象のエリアID集合。絞り込み不要ならnull。
 */
export function resolveAreaFilter(selectedAreaIdArray: readonly string[]): Set<string> | null {
  if (selectedAreaIdArray.length === 0) {
    return null;
  }
  return new Set(selectedAreaIdArray);
}
