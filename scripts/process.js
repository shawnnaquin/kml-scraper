const fse = require('fs-extra');
const path = require('path');
const xmlReader = require('read-xml');
const convert = require('xml-js');
const readdirp = require('readdirp');

const statefips = require('../src/statefips.json');

let type = ( process.argv.includes('--county') ) ? 'county' : 'zip' ? ( process.argv.includes('--city') ) ? 'city' : '' : false;

const DIST = path.resolve( __dirname, `../dist/complex/${type}/` );

let FILES = [ ];

let promiseArray = [];
let dataArray = [];

let start = () => {

    fse.removeSync( DIST );

    for ( FILE of FILES ) {

        promiseArray.push(
            streamFile( FILE, promiseArray.length+1 )
        )

    }

    // TODO handle finish

};

let streamFile = ( FILE, idx ) => new Promise( ( resolve, reject ) => {

        let decodedXMLStream = fse.createReadStream( FILE ).pipe(
            xmlReader.createStream()
        );

        decodedXMLStream.on( 'data', ( xmlStr ) => {

            dataArray[idx] += xmlStr;
            // downloaded += xmlStr.length;

            // let factor = 100;
            // let dlSize = downloaded/factor;
            // let contentSize = size;

            // let per = Math.round( ( dlSize/(contentSize/10000) ) * 0.3 );

            // percent[ per + 1 ] = '#';
            // percent.fill('#', 1, per+1 );

            // let t = `${ percent.join('') }`;

            // if (  dlSize/(contentSize/100000000000) > 999990000 ) {
            //     process.stdout.write( `...reading... ${t} ${Math.round( per/3*10 )}%\n` );
            //     process.stdout.write( 'done reading!\n' );
            // } else {
            //     process.stdout.write( `FILE: ${ FILE.split('/')[ FILE.split('/').length - 1 ] }    ${currentFileNum} of ${filesTotal}\n\r`);
            //     process.stdout.write( `...reading... ${t} ${Math.round( per/3*10 )}%\r` );
            // }

        });

        console.log( FILE, idx );

        decodedXMLStream.on( 'end', () => {
            processFile( FILE, idx, dataArray[idx], resolve, reject );
        });

});

let processFile = ( FILE, idx, data, resolve, reject ) => {

    setTimeout( ()=> {
        resolve(true);
        let remainingPromises = promiseArray.slice( idx ).length;
        // console.log( `remain: ${remainingPromises}, cur: ${idx}` );
        console.log( data )
    }, 100 * idx );

};


if ( type === 'county' || type === 'zip' ) {

    FILES.push(
        type === 'county' ?
            path.resolve( __dirname, '../src/cb_2017_us_county_20m.kml') :
            path.resolve( __dirname, '../src/cb_2017_us_zcta510_500k.kml')
    );

    start();

} else if ( type === 'city' ) {

    readdirp(
        path.resolve( __dirname, `../src/citykml`),
        {
            type: 'files',
            fileFilter: [ '*.kml' ],
            depth: 1
        }
    )
        .on('data', (entry) => {
            const {fullPath} = entry;
            FILES.push( fullPath );
        })
        // .on('warn', error => console.error('non-fatal error', error))
        .on('error', error => console.error('fatal error', error))
        .on('end', () => start() );

} else {
    console.log( 'check the KEY in argv!!!');
}
