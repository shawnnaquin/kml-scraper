const fse = require('fs-extra');
const path = require('path');
const xmlReader = require('read-xml');
const convert = require('xml-js');
const statefips = require('../src/statefips.json');

let type = process.argv.includes('--county') ?
    'county' : 'zip';

const FILE = type === 'county' ?
    path.resolve( __dirname, '../src/cb_2017_us_county_20m.kml') :
    path.resolve( __dirname, '../src/cb_2017_us_zcta510_500k.kml');


const DIST = path.resolve( __dirname, `../dist/complex/${type}/` );

let dupes = [];

fse.removeSync( DIST );

// TODO
// WORKING ON PROGRESS BARS

// reset();

// let downloaded;
// let percent;
// let content = '';

// let reset = () => {
//     downloaded = 0;
//     percent = `[                               ]`;
// };

// let size = fse.statSync( FILE ).size;

// let decodedXMLStream = fse.createReadStream( FILE ).pipe(
//     xmlReader.createStream()
// );

// percent = percent.split('');

// decodedXMLStream.on( 'data', ( xmlStr ) => {

//     content += xmlStr;

//     downloaded += xmlStr.length;
//     let per = Math.round( downloaded / size * 30 );
//     percent[ per + 1 ] = '#';

//     let t = `${ percent.join('') }`;

//     if (downloaded >= size ) {
//         console.log( `done reading! ${t} 100%\r` );
//     } else {
//         process.stdout.write( `...reading... ${t} ${Math.round( per/3*10 )}%\r` );
//     }

// });

// decodedXMLStream.on( 'end', ( ) => {
//     done();
// });

let done = ( data ) => {

    // reset();

    console.log('processing...');

    let xml = data.content;
    let result = JSON.parse( convert.xml2json( xml, { compact: true, spaces: 4 } ) );
    let places = result.kml.Document.Folder.Placemark;

    // console.log( places );

  // var proc = require('child_process').spawn('pbcopy');
  // proc.stdin.write(xml);
  // proc.stdin.end();

    Object.keys( places ).forEach( ( place, placeIndex ) => {

        let $item = places[place];
        // let $item = places[0];
        let normalizedStateName;

        // console.log($item);

        let rawName = $item.name._text.split(' ').join('_');
        let parsedName = rawName.split('<at><openparen>')[1].split('<closeparen>')[0];
        let lowerCaseName = parsedName.toLocaleLowerCase();
        let normalizedName = lowerCaseName.normalize('NFD').replace(/[\u0300-\u036f]/g, "");

        for ( let $extra of $item.ExtendedData.SchemaData.SimpleData ) {

            if ( $extra._attributes.name === 'STATEFP' ) {
                normalizedStateName = statefips[$extra._text].split(' ').join('_').toLocaleLowerCase();
            }

        }

        const NAME = normalizedStateName ? `${normalizedStateName}_${normalizedName}` : `${normalizedName}`;

        let newResult = result;

        delete newResult.kml.Document.Folder;
        delete newResult.kml.Document.Style.IconStyle;
        delete newResult.kml.Document.Style.LabelStyle;
        delete newResult.kml.Document.Schema.SimpleField

        delete $item.description;
        delete $item.ExtendedData;

        newResult.kml.Document.name = type;

        $item._attributes.id = NAME;
        $item.name._text = NAME;


        newResult.kml.Document.Folder = {
            name: NAME,
            Placemark: [ $item ]
        };

        let newXML = xml;

        newXML = convert.json2xml( newResult, { compact: true, ignoreComment: true, spaces: 0 } );

        if ( !dupes.includes( NAME ) ) {

            fse.ensureDir( DIST )
                .then( ( ) => {
                    const FILE = path.join( DIST, `/${ NAME }.kml` );
                    fse.ensureFile( FILE )
                        .then( ( ) => {
                            fse.writeFile( FILE, newXML, function( err, data ) {
                                if (err) {
                                    console.log( err );
                                }
                                else {
                                    // console.log('updated!');
                                }
                            });
                        })
                        .catch( err => {
                            console.error( err )
                        })
                })
                .catch( err => {
                    console.error( err )
                });
            dupes.push( NAME );
        } else {
            console.log( 'dupe!', NAME );
        }


    });

}

xmlReader.readXML( fse.readFileSync( FILE ), function( err, data ) {

    process.stdout.write( `reading...\r` );

    if ( err ) {
        console.error(err);
    }

    done( data );

});
