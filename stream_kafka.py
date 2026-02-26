#!/usr/bin/env python3
"""
Stream messages from Kafka topics to monitor CDC data flow.
Usage: python stream_kafka.py [topic_pattern]
"""

import sys
import json
from kafka import KafkaConsumer
from datetime import datetime

# Kafka configuration
BOOTSTRAP_SERVERS = ['localhost:9092']
TOPIC_PREFIX = 'siawin0'

# All CDC topics (23 tables + DLQ)
CDC_TOPICS = [
    f'{TOPIC_PREFIX}.in04', f'{TOPIC_PREFIX}.in11', f'{TOPIC_PREFIX}.in13', f'{TOPIC_PREFIX}.in14',
    f'{TOPIC_PREFIX}.in16', f'{TOPIC_PREFIX}.in34', f'{TOPIC_PREFIX}.in42', f'{TOPIC_PREFIX}.in64',
    f'{TOPIC_PREFIX}.in97', f'{TOPIC_PREFIX}.fa01', f'{TOPIC_PREFIX}.fa12', f'{TOPIC_PREFIX}.fa20',
    f'{TOPIC_PREFIX}.fa25', f'{TOPIC_PREFIX}.cp10', f'{TOPIC_PREFIX}.cp11', f'{TOPIC_PREFIX}.cp12',
    f'{TOPIC_PREFIX}.cp21', f'{TOPIC_PREFIX}.cp31', f'{TOPIC_PREFIX}.cc10', f'{TOPIC_PREFIX}.co00',
    f'{TOPIC_PREFIX}.ba10', f'{TOPIC_PREFIX}.tc', f'{TOPIC_PREFIX}.ge01', f'{TOPIC_PREFIX}.dlq'
]

def stream_messages(topics, max_messages=100):
    """Stream messages from specified Kafka topics."""
    print(f"🚀 Connecting to Kafka at {BOOTSTRAP_SERVERS}")
    print(f"📡 Subscribing to topics: {', '.join(topics)}")
    print(f"⏰ Streaming up to {max_messages} messages (Ctrl+C to stop)")
    print("-" * 80)
    
    try:
        consumer = KafkaConsumer(
            *topics,
            bootstrap_servers=BOOTSTRAP_SERVERS,
            auto_offset_reset='latest',  # Start from latest messages
            enable_auto_commit=True,
            value_deserializer=lambda m: json.loads(m.decode('utf-8')) if m else None,
            key_deserializer=lambda k: k.decode('utf-8') if k else None,
            consumer_timeout_ms=1000  # Timeout after 1 second of no messages
        )
        
        message_count = 0
        topic_counts = {}
        
        while message_count < max_messages:
            message_pack = consumer.poll(timeout_ms=1000)
            
            if not message_pack:
                print("⏳ Waiting for messages...")
                continue
            
            for topic_partition, messages in message_pack.items():
                for message in messages:
                    message_count += 1
                    topic_counts[topic_partition.topic] = topic_counts.get(topic_partition.topic, 0) + 1
                    
                    # Format the message
                    timestamp = datetime.now().strftime("%H:%M:%S")
                    topic = topic_partition.topic.replace(f'{TOPIC_PREFIX}.', '').upper()
                    key = message.key or "null"
                    
                    print(f"\n[{timestamp}] 📨 {topic} | Key: {key}")
                    print(f"   Partition: {message.partition} | Offset: {message.offset}")
                    
                    if message.value:
                        # Pretty print JSON value
                        if isinstance(message.value, dict):
                            # Show key fields for CDC events
                            if 'operation' in message.value:
                                op = message.value.get('operation', 'unknown')
                                table = message.value.get('table', 'unknown')
                                print(f"   🔄 Operation: {op} | Table: {table}")
                            
                            # Show first few fields
                            fields = list(message.value.keys())[:5]
                            print(f"   📋 Fields: {', '.join(fields)}")
                            
                            # Show row count if present
                            if 'row_count' in message.value:
                                print(f"   📊 Rows: {message.value['row_count']}")
                        else:
                            print(f"   📄 Value: {str(message.value)[:200]}...")
                    
                    print("-" * 40)
                    
                    if message_count >= max_messages:
                        break
            
            # Show summary every 10 messages
            if message_count > 0 and message_count % 10 == 0:
                print(f"\n📊 Summary: {message_count} messages received")
                for topic, count in sorted(topic_counts.items()):
                    print(f"   {topic}: {count}")
                print()
        
        # Final summary
        print(f"\n✅ Streaming complete! Total messages: {message_count}")
        print("📊 Topic breakdown:")
        for topic, count in sorted(topic_counts.items()):
            print(f"   {topic}: {count}")
            
    except KeyboardInterrupt:
        print(f"\n⏹️  Streaming stopped by user. Total messages: {message_count}")
    except Exception as e:
        print(f"\n❌ Error: {e}")
    finally:
        consumer.close()

def main():
    # Determine which topics to stream
    if len(sys.argv) > 1:
        pattern = sys.argv[1].lower()
        if pattern == 'all':
            topics = CDC_TOPICS
        else:
            # Filter topics by pattern (e.g., 'in' for inventory, 'fa' for facturacion)
            topics = [t for t in CDC_TOPICS if pattern in t]
            if not topics:
                print(f"❌ No topics found matching pattern '{pattern}'")
                print(f"Available patterns: in, fa, cp, cc, co, ba, tc, ge, dlq")
                return
    else:
        # Default to a few active topics
        topics = [
            f'{TOPIC_PREFIX}.in04',  # productos
            f'{TOPIC_PREFIX}.fa12',  # facturas
            f'{TOPIC_PREFIX}.cp10',  # ordenes_compra
            f'{TOPIC_PREFIX}.dlq'    # dead letter queue
        ]
    
    stream_messages(topics, max_messages=50)

if __name__ == "__main__":
    main()
