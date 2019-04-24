const fse = require('fs-extra');
const path = require('path');
const xmlReader = require('read-xml');
const convert = require('xml-js');
const readdirp = require('readdirp');

const statefips = require('../src/statefips.json');

let type = ( process.argv.includes('--county') ) ? 'county' : 'zip' ? ( process.argv.includes('--city') ) ? 'city' : '' : false;

const DIST = path.resolve( __dirname, `../dist/complex/${type}/` );

let FILES = [ ];

// let dupes = [];
// let current = 0;
// let percent = '';
// let downloaded = 0;
// let size = 0;
// let currentFileNum = 0;
// let filesTotal = 0;
//
// let reset = () => {
//     dupes = [];
//     current = 0;
//     percent = '';
//     content = '';
//     downloaded = 0;
//     percent = "[------------------------------]";
//     percent = percent.split('');
// };

let promiseArray = [];
let dataArray = [];

let start = () => {

    fse.removeSync( DIST );

    for (FILE of FILES) {

        promiseArray.push(
            processFile( FILE, promiseArray.length )
        )

    }

    // TODO handle finish

};

let processFile = ( FILE, idx ) => new Promise( ( resolve, reject ) => {

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
        //
        // });

        decodedXMLStream.on( 'end', () => {
            done( FILE, idx, resolve, reject );
        });

});

let done = (FILE, idx, resolve, reject ) {

}

//     // }
//
// };
//
// let done = ( data ) => {
//
//     reset();
//     console.log( 'converting...                                                         \n');
//     let xml = data;
//     let result = JSON.parse( convert.xml2json( xml, { compact: true, spaces: 4 } ) );
//     let places = result.kml.Document.Folder.Placemark;
//
//     size = Object.keys( places ).length;
//
//     let dlSize = 0;
//
//     let timer;
//
//     let percentBar = () => {
//
//         dlSize+=1;
//
//         let per = Math.round( ( dlSize/size*100 ) * 0.3 );
//         // percent[ per + 1 ] = '#';
//         percent.fill('#', 1, per+1 );
//
//         let t = `${ percent.join('') }`;
//         // console.log( );
//         if (  dlSize/size*100 >= 99 ) {
//             clearTimeout( timer );
//             timer = setTimeout( ()=> {
//                 process.stdout.write( `saving JSON : ${t} ${Math.round( per/3*10 )}%\n` );
//                 console.log( `done saving!                                                `);
//             }, 1000 );
//         } else {
//             process.stdout.write( `processing : ${t} ${Math.round( per/3*10 )}%\r` );
//         }
//
//     };
//
//     Object.keys( places ).forEach( ( place, placeIndex ) => {
//
//         let $item = places[place];
//         // let $item = places[0];
//         let normalizedStateName;
//
//         let rawName = $item.name._text.split(' ').join('_');
//         let parsedName = rawName.split('<at><openparen>')[1].split('<closeparen>')[0];
//         let lowerCaseName = parsedName.toLocaleLowerCase();
//         let normalizedName = lowerCaseName.normalize('NFD').replace(/[\u0300-\u036f]/g, "");
//
//         for ( let $extra of $item.ExtendedData.SchemaData.SimpleData ) {
//
//             if ( $extra._attributes.name === 'STATEFP' ) {
//                 normalizedStateName = statefips[$extra._text].split(' ').join('_').toLocaleLowerCase();
//             }
//
//         }
//
//         const NAME = normalizedStateName ? `${normalizedStateName}_${normalizedName}` : `${normalizedName}`;
//
//         let newResult = result;
//
//         delete newResult.kml.Document.Folder;
//         delete newResult.kml.Document.Style.IconStyle;
//         delete newResult.kml.Document.Style.LabelStyle;
//         delete newResult.kml.Document.Schema.SimpleField
//
//         delete $item.description;
//         delete $item.ExtendedData;
//
//         newResult.kml.Document.name = type;
//
//         $item._attributes.id = NAME;
//         $item.name._text = NAME;
//
//
//         newResult.kml.Document.Folder = {
//             name: NAME,
//             Placemark: [ $item ]
//         };
//
//         let newXML = xml;
//
//         newXML = convert.json2xml( newResult, { compact: true, ignoreComment: true, spaces: 0 } );
//
//
//         if ( !dupes.includes( NAME ) ) {
//
//             fse.ensureDir( DIST )
//                 .then( ( ) => {
//                     const FILE = path.join( DIST, `/${ NAME }.kml` );
//                     fse.ensureFile( FILE )
//                         .then( ( ) => {
//                             fse.writeFile( FILE, newXML, function( err, data ) {
//                                 if (err) {
//                                     console.log( err );
//                                 } else {
//                                     percentBar();
//                                 }
//                             });
//                         })
//                         .catch( err => {
//                             console.error( err )
//                         })
//                 })
//                 .catch( err => {
//                     console.error( err )
//                 });
//             dupes.push( NAME );
//         } else {
//             // console.log( 'dupe!', NAME );
//             // BLACK HOLE
//         }
//
//     });
//
// };

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
