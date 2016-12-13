<?php
$ABSOLUTE_PATH = '/your/path/here/';

//allow remote ajax uploads
header("Access-Control-Allow-Origin: *");

if (count($_FILES) > 0 && (isset($_POST['ext']))) {
    //give the file a random name
    $uuid = v4();
    //upload the file and return the file ID
    move_uploaded_file($_FILES['file']['tmp_name'], $ABSOLUTE_PATH . $uuid . $_POST['ext']);
    echo json_encode(array("_id" => $uuid.$_POST['ext']));
}
else {
    echo "{}";
}

function v4()
{
    return sprintf('%04x%04x-%04x-%04x-%04x-%04x%04x%04x', mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0x0fff) | 0x4000, mt_rand(0, 0x3fff) | 0x8000, mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff));
}