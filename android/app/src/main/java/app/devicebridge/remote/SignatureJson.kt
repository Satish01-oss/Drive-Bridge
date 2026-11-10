package app.devicebridge.remote

// Pure Kotlin signed JSON contract, shared by native signing and JVM checks.
internal object SignatureJson {
    fun canonical(value: Any?): String = when(value) {
        null -> "null"
        is String -> quote(value)
        is Boolean -> value.toString()
        is Number -> { val n=value.toLong(); require(n.toDouble()==value.toDouble() && n in -9007199254740991L..9007199254740991L); n.toString() }
        is List<*> -> value.joinToString(",","[","]") { canonical(it) }
        is Map<*,*> -> { require(value.keys.all{it is String}); value.keys.map{it as String}.sorted().joinToString(",","{","}") { quote(it)+":"+canonical(value[it]) } }
        else -> throw IllegalArgumentException("Invalid signed value")
    }
    private fun quote(text: String): String=buildString {
        append('"')
        for(i in text.indices) {
            val c=text[i]
            when(c) {
                '"'->append("\\\""); '\\'->append("\\\\"); '\b'->append("\\b"); '\u000c'->append("\\f"); '\n'->append("\\n"); '\r'->append("\\r"); '\t'->append("\\t")
                else -> {
                    val paired=(Character.isHighSurrogate(c)&&i+1<text.length&&Character.isLowSurrogate(text[i+1]))||(Character.isLowSurrogate(c)&&i>0&&Character.isHighSurrogate(text[i-1]))
                    if(c.code<32 || (Character.isSurrogate(c)&&!paired)) append("\\u"+c.code.toString(16).padStart(4,'0')) else append(c)
                }
            }
        }
        append('"')
    }
}
