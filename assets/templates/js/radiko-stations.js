/**
 * Radiko Stations 表示用スクリプト
 * API からデータを取得してテーブルに表示
 */

/**
 * 放送局データを API から取得して表示
 */
async function loadStations() {
    const loading = document.getElementById( 'loading' );
    const error = document.getElementById( 'error' );
    const table = document.getElementById( 'stationsTable' );
    const tbody = document.getElementById( 'stationsBody' );

    try {
        // API からデータ取得
        const response = await fetch( window.API_ENDPOINT );

        if ( !response.ok ) {
            throw new Error( `HTTP error! status: ${ response.status }` );
        }

        const data = await response.json();
        const stations = data.stations || [];

        // ローディング非表示
        loading.style.display = 'none';

        if ( stations.length === 0 ) {
            tbody.innerHTML = '<tr><td colspan="4" class="no-data">No stations available</td></tr>';
        } else {
            // テーブル行を生成
            tbody.innerHTML = stations.map( station => `
                <tr>
                    <td>${ escapeHtml( station.stationId ) }</td>
                    <td>${ escapeHtml( station.name ) }</td>
                    <td>${ escapeHtml( station.region ) }</td>
                    <td>${ escapeHtml( station.area ) }</td>
                </tr>
            `).join( '' );
        }

        // テーブル表示
        table.style.display = 'table';

    } catch ( err ) {
        // エラー表示
        loading.style.display = 'none';
        error.textContent = `Failed to load stations: ${ err.message }`;
        error.style.display = 'block';
        console.error( 'Error loading stations:', err );
    }
}

/**
 * HTML エスケープ処理
 * XSS 攻撃を防ぐため、特殊文字をエスケープ
 * @param {string} text - エスケープする文字列
 * @returns {string} エスケープされた文字列
 */
function escapeHtml( text ) {
    const div = document.createElement( 'div' );
    div.textContent = text;
    return div.innerHTML;
}

// ページ読み込み時に実行
document.addEventListener( 'DOMContentLoaded', loadStations );