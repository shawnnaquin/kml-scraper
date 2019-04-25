const fse = require('fs-extra');
const path = require('path');
const xmlReader = require('read-xml');
const convert = require('xml-js');
console.log( process.argv );
// // const statefips = require('../src/statefips.json');

// let type = `dma`;

// const DIST = path.resolve( __dirname, `../dist/complex/${type}` );
// const FILE = path.resolve( __dirname, `../dist/temp/${type}/geodma.json` );

// dmaFile = path.resolve( __dirname, `../src/dmainfo.json` );
// let dmainfo = JSON.parse( fse.readFileSync( dmaFile ) );

// fse.remove( DIST );

// process.stdout.write( `reading json... \r\n` );

// let stream = fse.createReadStream( FILE, {flags: 'r', encoding: 'utf-8'} );

// class Template {
//     constructor() {
//         this.type="FeatureCollection";
//         this.features = [];
//     }
// }

// let content = '';

// let total = 0;
// // let current = 0;
// // let percent = 0;

// // let percentBar = () => {
// //
// //     current += 1;
// //     percent = current/total*100;
// //
// // };

// let done = () => {

//     process.stdout.write( `parsing json... \r\n` );
//     content = JSON.parse( content );

//     total = Object.keys( content.features ).length;

//     process.stdout.write( `parsed!\r\n`);
//     process.stdout.write( `processing: ${total} zones...      \r\n` );

//     // let tempArray = [];

//     for( $feature of content.features ) {

//         let $template = new Template();
//         $template.features.push( $feature );

//         let $file = JSON.stringify( $template );
//         let $id = $feature.properties.dma;

//         dmainfo[$id] = {
//             ...dmainfo[$id],
//             ...$feature.properties
//         };

//         fse.writeFile( dmaFile, JSON.stringify( dmainfo, null, 4 ), ( err, data ) => {
//             if (err) { console.log( err ) }
//         });

//         fse.ensureDir( DIST )
//             .then( ( ) => {
//                 const FILE = path.join( DIST, `/${$id}.json` );
//                 fse.ensureFile( FILE )
//                     .then( ( ) => {
//                         fse.writeFile( FILE, $file, ( err, data ) => {
//                             if (err) {
//                                 console.log( err );
//                             } else {
//                                 // percentBar();
//                             }
//                         });
//                     })
//                     .catch( err => {
//                         console.error( err )
//                     })
//             })
//             .catch( err => {
//                 console.error( err )
//             });

//     }

//     // console.log( JSON.stringify( tempArray.sort() ) );

//     console.log( 'done!' );
// };

// stream.on( 'data', ( data ) => {
//     content += data.toString();
// });

// stream.on( 'end', ( ) => {
//     done();
// });

