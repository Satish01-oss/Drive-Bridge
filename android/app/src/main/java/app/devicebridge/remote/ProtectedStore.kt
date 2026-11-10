package app.devicebridge.remote

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.AtomicFile
import android.util.Base64
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.params.Ed25519PublicKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import org.bouncycastle.asn1.x509.SubjectPublicKeyInfo
import org.bouncycastle.asn1.x509.AlgorithmIdentifier
import org.bouncycastle.asn1.ASN1ObjectIdentifier
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class ProtectedStore(private val context: Context) {
    private val alias = "DeviceBridge.Remote.Storage.v1"
    private fun key(): SecretKey {
        val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)}
        (store.getKey(alias,null) as? SecretKey)?.let{return it}
        return KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply{init(KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).setKeySize(256).build())}.generateKey()
    }
    private fun file(name: String)=AtomicFile(File(context.filesDir,"remote-$name.bin"))
    private fun read(name: String): ByteArray? {
        val file=file(name);if(!file.baseFile.exists())return null
        val bytes=file.openRead().use{it.readBytes()};require(bytes.size>28){"Invalid protected device data"}
        return Cipher.getInstance("AES/GCM/NoPadding").apply{init(Cipher.DECRYPT_MODE,key(),GCMParameterSpec(128,bytes.copyOfRange(0,12)))}.doFinal(bytes.copyOfRange(12,bytes.size))
    }
    private fun write(name: String,bytes: ByteArray) {
        val cipher=Cipher.getInstance("AES/GCM/NoPadding").apply{init(Cipher.ENCRYPT_MODE,key())};val protected=cipher.iv+cipher.doFinal(bytes);val file=file(name);val output=file.startWrite()
        try{output.write(protected);file.finishWrite(output)}catch(error:Exception){file.failWrite(output);throw error}
    }
    private fun seed(): ByteArray {val saved=read("identity");if(saved!=null){require(saved.size==32);return saved};return ByteArray(32).also{SecureRandom().nextBytes(it);write("identity",it)}}
    private fun encoded(bytes: ByteArray)=Base64.encodeToString(bytes,Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
    fun publicKey(): String {val seed=seed();try{val key=Ed25519PrivateKeyParameters(seed,0).generatePublicKey();return encoded(SubjectPublicKeyInfo(AlgorithmIdentifier(ASN1ObjectIdentifier("1.3.101.112")),key.encoded).encoded)}finally{seed.fill(0)}}
    fun sign(purpose: String,value: Any?): String {
        require(purpose in listOf("auth","grant","signal")){"Unsupported signing purpose"};val bytes=("devicebridge.$purpose.v1\n"+canonical(value)).toByteArray(Charsets.UTF_8);require(bytes.size<=65536)
        val seed=seed();try{val signer=Ed25519Signer();signer.init(true,Ed25519PrivateKeyParameters(seed,0));signer.update(bytes,0,bytes.size);return encoded(signer.generateSignature())}finally{seed.fill(0)}
    }
    fun get(name: String): Any {require(name=="grants");return read(name)?.let{JSONArray(it.toString(Charsets.UTF_8))}?:JSONObject.NULL}
    fun verify(publicKey:String,purpose:String,value:Any?,signature:String):Boolean {
        return try{require(purpose in listOf("auth","grant","signal"));require(publicKey.length==59&&signature.length==86);val key=SubjectPublicKeyInfo.getInstance(Base64.decode(publicKey,Base64.URL_SAFE or Base64.NO_WRAP));require(key.algorithm.algorithm.id=="1.3.101.112");val bytes=("devicebridge.$purpose.v1\n"+canonical(value)).toByteArray(Charsets.UTF_8);require(bytes.size<=65536);val verifier=Ed25519Signer();verifier.init(false,Ed25519PublicKeyParameters(key.publicKeyData.bytes,0));verifier.update(bytes,0,bytes.size);verifier.verifySignature(Base64.decode(signature,Base64.URL_SAFE or Base64.NO_WRAP))}catch(_:Exception){false}
    }
    fun set(name: String,value: Any?) {require(name=="grants"&&value is JSONArray&&value.length()<=1000);val bytes=value.toString().toByteArray(Charsets.UTF_8);require(bytes.size<=2*1024*1024);write(name,bytes)}
    companion object {
        private fun jsonValue(value: Any?): Any?=when(value){
            null,JSONObject.NULL->null
            is JSONArray->(0 until value.length()).map{jsonValue(value.get(it))}
            is JSONObject->value.keys().asSequence().associateWith{jsonValue(value.get(it))}
            else->value
        }
        fun canonical(value: Any?): String=SignatureJson.canonical(jsonValue(value))
    }
}
