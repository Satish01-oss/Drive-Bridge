package app.devicebridge.remote

import org.junit.Assert.*
import org.junit.Test
import org.bouncycastle.crypto.params.Ed25519PrivateKeyParameters
import org.bouncycastle.crypto.signers.Ed25519Signer
import java.util.Base64

class SignatureJsonTest {
    @Test fun sortedUnicodeContract() {
        val value=linkedMapOf("z" to "Hello 👋 नमस्ते \u2028", "a" to listOf(1,true,null))
        assertEquals("{\"a\":[1,true,null],\"z\":\"Hello 👋 नमस्ते \u2028\"}",SignatureJson.canonical(value))
    }
    @Test fun escapesControlsAndUnpairedSurrogates() {
        assertEquals("\"\\u0000\\n\\t\\\"\\\\\\ud800\"",SignatureJson.canonical("\u0000\n\t\"\\\ud800"))
    }
    @Test fun rejectsUnsafeOrFractionalNumbers() {
        for(value in listOf(1.5,Double.NaN,Double.POSITIVE_INFINITY,9007199254740992L)) {
            try { SignatureJson.canonical(value);fail("Unsafe number was accepted") } catch(_:IllegalArgumentException) { }
        }
        assertEquals("9007199254740991",SignatureJson.canonical(9007199254740991L))
    }
    @Test fun signsTheSamePublicVectorAsNodeAndWindows() {
        val value=linkedMapOf("z" to "Hello 👋 नमस्ते \u2028", "a" to listOf(1,true,null))
        val bytes=("devicebridge.grant.v1\n"+SignatureJson.canonical(value)).toByteArray(Charsets.UTF_8)
        val signer=Ed25519Signer();signer.init(true,Ed25519PrivateKeyParameters(ByteArray(32){it.toByte()},0));signer.update(bytes,0,bytes.size)
        assertEquals(EXPECTED_SIGNATURE,Base64.getUrlEncoder().withoutPadding().encodeToString(signer.generateSignature()))
    }
    companion object { const val EXPECTED_SIGNATURE="bwLgLEqp0K_mKqRYyrc_UTd5tWGIHT3MiCqjCoeaCK2hKAvnCpEI_pTP2dk7o2xCoykorfznBvQONNiJbVaaAw" }
}
