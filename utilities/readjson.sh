FILE=$1;
REGEXFILE=$( cat "./package.json" | grep -E "\b$FILE\b" );
CLEANEDFILE=$( echo $REGEXFILE | awk '{print$2}' | cut -d '"' -f2 | cut -d ',' -f1 );
echo $CLEANEDFILE;