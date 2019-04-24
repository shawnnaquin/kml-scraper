#!/usr/bin/env bash
PRECISION=0.001;
GEOPRECISION=$(echo "$PRECISION * 6000" | bc)

TYPE=$1;
FILETYPE=$2;

SIMPLE=dist/simplified/$TYPE;
COMPLEX=dist/complex/$TYPE;
TEMP=dist/temp/$TYPE;

COUNT=$(find $COMPLEX -name "*.$FILETYPE" -maxdepth 1 -type f | wc -l);

SECONDS=0
i=0;
total=0;

rm -rf $SIMPLE && mkdir $SIMPLE

function ProgressBar {
	tput sc
	# Process data
    _de=1;
    _dur=1;

    let _progress=(${1}*100/${2}*100)/100
    if [ $_progress -gt 0 ]; then
        _de=$_progress;
    else
    	_de=1;
    fi

    let _done=(${_progress}*1)/10
    let _left=10-$_done

    # Build progressbar string lengths
    _fill=$(printf "%${_done}s")
    _empty=$(printf "%${_left}s")

    prefix="\rProgress : ";

    bar="[${_fill// /#}${_empty// /-}]";

    per=${_de}%%;
    perdone=$(( 100-${_de} ))%%;

    elapsedminutes=$(($4/60))m;
    elapsedseconds=$(($4%60))s;
    elapsed=$elapsedminutes$elapsedseconds;

    if [ $4 -gt 0 ]; then
	    _dur=$4;
	else
		_dur=1;
	fi

	estimate=$(( $_dur/$_de*100 ));
    estimatedminutes=$(($estimate/60))m;
    estimatedseconds=$(($estimate%60))s;
    est=$estimatedminutes$estimatedseconds;

    timeleft=1;

    if [ $estimate -gt $4 ]; then
    	timeleft=$(( $estimate - $4 ));
	else
		timeleft=1;
	fi

    timeleftminutes=$(($timeleft/60))m;
    timeleftseconds=$(($timeleft%60))s;
    tl=$timeleftminutes$timeleftseconds;

	# 1.2 Build progressbar strings and print the ProgressBar line
	# 1.2.1 Output example:
	# 1.2.1.1 Progress : [########################################] 100%
    if [ $1 -eq $2 ]
        then
            printf "$prefix $per $bar $perdone    elapsed: $elapsed | time-left: $tl | total(est): $est    $1 / $2 - $3                                     \n";
            echo "done $(du -hsc $SIMPLE)"
        else
            tput rmam
                printf "$prefix $per $bar $perdone    elapsed: $elapsed | time-left: $tl | total(est): $est    $1 / $2 - $3                                     \r"
            tput smam
    fi

}

for f in ${COMPLEX}/*.${FILETYPE} ; do FILENAME=`basename ${f} .${FILETYPE}`;

    i=$(($i+1));

    if [ "${FILETYPE}" == "kml" ];
        then
            {
                ogr2ogr -f libkml -simplify $PRECISION ${TEMP}/${FILENAME}.${FILETYPE} ${COMPLEX}/${FILENAME}.${FILETYPE};
                ogr2ogr -f GeoJSON ${SIMPLE}/${FILENAME}.json ${TEMP}/${FILENAME}.${FILETYPE};
            } &> /dev/null;
        else
            {
                ogr2ogr -f GeoJSON -lco COORDINATE_PRECISION=${GEOPRECISION} ${SIMPLE}/${FILENAME}.json ${COMPLEX}/${FILENAME}.${FILETYPE};
            } &> /dev/null;
    fi

    duration=$SECONDS
    ProgressBar $i $COUNT $FILENAME $duration;

done;